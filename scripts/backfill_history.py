#!/usr/bin/env python3
"""
AI Papers Daily - 历史数据补充脚本
用途：补充指定日期的历史热点论文（从 HuggingFace 历史 API 真实获取）
运行：python scripts/backfill_history.py --dates 2026-03-05 2026-03-06
"""

import os
import sys
import json
import time
import re
import ssl
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ===== 自动加载 .env =====
def _load_dotenv():
    script_dir = Path(__file__).parent
    for env_file in [script_dir / ".env", script_dir.parent / ".env"]:
        if env_file.exists():
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
            break

_load_dotenv()

# ===== SSL =====
try:
    import certifi
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = ssl._create_unverified_context()

# ===== 配置 =====
HF_API_TOKEN   = os.getenv("HF_API_TOKEN", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "Qwen/Qwen2.5-7B-Instruct")
REQUEST_INTERVAL = float(os.getenv("REQUEST_INTERVAL", "1"))
MAX_RETRY      = int(os.getenv("MAX_RETRY", "3"))
DAILY_TARGET   = 10

DATA_DIR  = Path(__file__).parent.parent / "data"
DAILY_DIR = DATA_DIR / "daily"
INDEX_FILE = DATA_DIR / "index.json"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    req.add_header("User-Agent", "AI-Papers-Daily/1.0")
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CONTEXT) as resp:
        return resp.read().decode("utf-8")

def http_post_json(url, data, headers=None):
    """发送 JSON POST 请求，使用 http.client 绕过 urllib 的 latin-1 header 限制"""
    import http.client
    import urllib.parse as _up
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    parsed = _up.urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    use_ssl = parsed.scheme == "https"
    conn = http.client.HTTPSConnection(host, context=_SSL_CONTEXT, timeout=60) if use_ssl else http.client.HTTPConnection(host, timeout=60)
    try:
        req_headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
        }
        for k, v in (headers or {}).items():
            req_headers[k] = v
        conn.request("POST", path, body=body, headers=req_headers)
        resp = conn.getresponse()
        resp_body = resp.read().decode("utf-8")
        if resp.status == 429:
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", {}, None)
        if resp.status >= 400:
            raise urllib.error.HTTPError(url, resp.status, resp.reason, {}, None)
        return json.loads(resp_body)
    finally:
        conn.close()

# ===== HuggingFace 历史 API =====

def fetch_hf_by_date(date_str):
    """
    从 HuggingFace Daily Papers API 获取指定日期的论文
    API: https://huggingface.co/api/daily_papers?date=YYYY-MM-DD
    """
    log(f"🤗 从 HuggingFace 获取 {date_str} 的论文...")
    items = []
    try:
        headers = {}
        if HF_API_TOKEN:
            headers["Authorization"] = f"Bearer {HF_API_TOKEN}"

        url = f"https://huggingface.co/api/daily_papers?date={date_str}"
        text = http_get(url, headers=headers, timeout=20)
        papers = json.loads(text)
        if not isinstance(papers, list):
            papers = papers.get("papers", [])

        log(f"  HuggingFace API 返回 {len(papers)} 篇")

        for paper in papers:
            try:
                p = paper.get("paper", paper)
                arxiv_id = p.get("id", "")
                if not arxiv_id:
                    continue
                authors = [
                    a.get("name", a) if isinstance(a, dict) else str(a)
                    for a in (p.get("authors") or [])
                ]
                upvotes = paper.get("numComments", 0) or paper.get("upvotes", 0) or 0
                hot_score = upvotes * 10 + (p.get("likes", 0) or 0)

                items.append({
                    "paper_id": f"hf-paper-{arxiv_id}",
                    "source": "huggingface",
                    "title": p.get("title", ""),
                    "authors": authors,
                    "abstract": p.get("summary", p.get("abstract", "")),
                    "published_date": p.get("publishedAt", paper.get("publishedAt", "")),
                    "url": f"https://arxiv.org/abs/{arxiv_id}",
                    "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
                    "code_url": None,
                    "hf_url": f"https://huggingface.co/papers/{arxiv_id}",
                    "category": "llm",
                    "tags": [],
                    "upvotes": upvotes,
                    "hot_score": hot_score,
                    "structured_summary": None,
                })
            except Exception as e:
                log(f"  解析论文失败: {e}")

        # 按热度排序取 TOP 10
        items.sort(key=lambda x: x.get("hot_score", 0), reverse=True)
        items = items[:DAILY_TARGET]
        log(f"  精选 TOP {len(items)} 篇（按热度排序）")

    except Exception as e:
        log(f"  HuggingFace 获取失败: {e}")

    return items

# ===== AI 摘要 =====

PAPER_PROMPT = """你是一位 AI 领域资深研究员，请对以下论文进行结构化分析，严格按 JSON 格式输出，不要输出任何其他内容。

论文标题：{title}
论文摘要：{abstract}

请输出如下 JSON（所有字段均用中文，字符串类型，数组每项不超过 30 字）：
{{
  "chinese_title": "论文中文标题（准确翻译）",
  "chinese_summary": "一句话核心贡献（不超过 60 字，不以"本文"开头）",
  "pain_point": "解决的核心痛点或问题（1-2句）",
  "core_value": "核心价值与创新点（1-2句）",
  "technical_architecture": "关键技术方法或架构（1-2句）",
  "quantitative_results": "主要量化实验结果（1-2句，如无则填"暂无量化数据"）",
  "competitors": "对比的主要基线或竞品（1-2句，如无则填"暂无对比信息"）",
  "limitations": "局限性或未来工作（1句）",
  "key_contributions": ["贡献点1", "贡献点2", "贡献点3"],
  "application_scenarios": ["应用场景1", "应用场景2"],
  "technical_highlights": ["技术亮点1", "技术亮点2"]
}}"""

def call_llm(prompt):
    if not OPENAI_API_KEY:
        return None
    base_url = OPENAI_BASE_URL.rstrip("/")
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    payload = {
        "model": OPENAI_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000,
        "temperature": 0.2,
    }

    def _do_request(p):
        for attempt in range(MAX_RETRY):
            try:
                resp = http_post_json(url, p, headers)
                return resp["choices"][0]["message"]["content"].strip()
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    wait = (attempt + 1) * 15
                    log(f"    ⏳ 触发限速(429)，等待 {wait}s 后重试 ({attempt+1}/{MAX_RETRY})...")
                    time.sleep(wait)
                else:
                    raise
        return None

    try:
        result = _do_request({**payload, "response_format": {"type": "json_object"}})
        if result:
            return result
    except Exception:
        pass
    try:
        return _do_request(payload)
    except Exception as e:
        log(f"    LLM 调用失败: {e}")
    return None

def parse_json_safe(text):
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return None

def generate_summary(paper):
    title = paper.get("title", "")
    abstract = (paper.get("abstract", "") or "")[:1200]
    prompt = PAPER_PROMPT.format(title=title, abstract=abstract)
    raw = call_llm(prompt)
    parsed = parse_json_safe(raw)
    if not parsed:
        return None
    return {
        "chinese_title": parsed.get("chinese_title", ""),
        "chinese_summary": parsed.get("chinese_summary", ""),
        "pain_point": parsed.get("pain_point", ""),
        "core_value": parsed.get("core_value", ""),
        "technical_architecture": parsed.get("technical_architecture", ""),
        "quantitative_results": parsed.get("quantitative_results", ""),
        "competitors": parsed.get("competitors", ""),
        "limitations": parsed.get("limitations", ""),
        "key_contributions": parsed.get("key_contributions", []),
        "application_scenarios": parsed.get("application_scenarios", []),
        "technical_highlights": parsed.get("technical_highlights", []),
        "model_used": OPENAI_MODEL,
    }

def generate_batch_summaries(papers):
    if not OPENAI_API_KEY:
        log("⚠️  未配置 OPENAI_API_KEY，跳过 AI 分析")
        return papers
    pending = [p for p in papers if not p.get("structured_summary")]
    log(f"🤖 开始生成 AI 分析: {len(pending)} 篇")
    success = 0
    for i, paper in enumerate(pending):
        try:
            summary = generate_summary(paper)
            if summary and summary.get("chinese_summary"):
                paper["structured_summary"] = summary
                success += 1
                log(f"  [{i+1}/{len(pending)}] ✓ {paper['title'][:50]}")
            else:
                log(f"  [{i+1}/{len(pending)}] ✗ AI 分析为空: {paper['title'][:40]}")
        except Exception as e:
            log(f"  [{i+1}/{len(pending)}] ✗ 异常: {e}")
        if i < len(pending) - 1:
            time.sleep(REQUEST_INTERVAL)
    log(f"  AI 分析完成: {success}/{len(pending)} 篇成功")
    return papers

# ===== 保存 =====

def save_daily_data(papers, date_str):
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    output_file = DAILY_DIR / f"{date_str}.json"
    papers.sort(key=lambda p: p.get("hot_score", 0), reverse=True)
    data = {
        "date": date_str,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(papers),
        "papers": papers,
    }
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log(f"💾 已保存: {output_file} ({len(papers)} 篇)")
    return len(papers)

def update_index(date_str, total):
    index = {"updated_at": "", "dates": [], "total_papers": 0}
    if INDEX_FILE.exists():
        try:
            with open(INDEX_FILE, "r", encoding="utf-8") as f:
                index = json.load(f)
        except Exception:
            pass
    dates = index.get("dates", [])
    found = False
    for d in dates:
        if d["date"] == date_str:
            d["total"] = total
            found = True
            break
    if not found:
        dates.insert(0, {"date": date_str, "total": total})
    dates.sort(key=lambda d: d["date"], reverse=True)
    dates = dates[:90]
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    index["dates"] = dates
    index["total_papers"] = sum(d["total"] for d in dates)
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    log(f"📋 已更新索引: {len(dates)} 个日期")

# ===== 主流程 =====

def backfill_date(date_str):
    log(f"\n{'='*50}")
    log(f"📅 补充 {date_str} 的历史论文")
    log(f"{'='*50}")

    # 检查是否已存在
    output_file = DAILY_DIR / f"{date_str}.json"
    if output_file.exists():
        log(f"⚠️  {date_str}.json 已存在，跳过（如需重新生成请先删除该文件）")
        return

    # 从 HuggingFace 获取历史数据
    papers = fetch_hf_by_date(date_str)

    if not papers:
        log(f"⚠️  {date_str} 未获取到论文，跳过")
        return

    # 生成 AI 分析
    papers = generate_batch_summaries(papers)

    # 保存
    total = save_daily_data(papers, date_str)
    update_index(date_str, total)
    log(f"✅ {date_str} 补充完成，共 {total} 篇")

def main():
    parser = argparse.ArgumentParser(description="补充历史日期的论文数据")
    parser.add_argument(
        "--dates", nargs="+",
        default=["2026-03-05", "2026-03-06"],
        help="要补充的日期列表，格式 YYYY-MM-DD"
    )
    args = parser.parse_args()

    log(f"=== AI Papers Daily 历史数据补充任务 ===")
    log(f"待补充日期: {', '.join(args.dates)}")

    for date_str in args.dates:
        backfill_date(date_str)

    log(f"\n=== 所有历史数据补充完成 ===")

if __name__ == "__main__":
    main()
