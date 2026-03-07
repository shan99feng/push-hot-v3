#!/usr/bin/env python3
"""
AI Papers Daily - 补充 AI 摘要脚本
用途：为已存在的 daily JSON 文件中缺少 structured_summary 的论文补充 AI 分析
运行：python scripts/fill_summaries.py
     python scripts/fill_summaries.py --dates 2026-03-05 2026-03-06
"""

import os
import sys
import json
import time
import re
import ssl
import argparse
import urllib.error
import http.client
import urllib.parse
from datetime import datetime, timezone
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
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL", "Qwen/Qwen2.5-7B-Instruct")
REQUEST_INTERVAL = float(os.getenv("REQUEST_INTERVAL", "1"))
MAX_RETRY       = int(os.getenv("MAX_RETRY", "3"))

DATA_DIR  = Path(__file__).parent.parent / "data"
DAILY_DIR = DATA_DIR / "daily"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

# ===== HTTP =====
def http_post_json(url, data, headers=None):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    conn = http.client.HTTPSConnection(host, context=_SSL_CONTEXT, timeout=60)
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
            raise urllib.error.HTTPError(url, resp.status, f"HTTP {resp.status}: {resp_body[:200]}", {}, None)
        return json.loads(resp_body)
    finally:
        conn.close()

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
    url = OPENAI_BASE_URL.rstrip("/") + "/chat/completions"
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

    # 先尝试带 json_object 格式
    try:
        result = _do_request({**payload, "response_format": {"type": "json_object"}})
        if result:
            return result
    except Exception:
        pass
    # 降级：不带 response_format
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
    raw = call_llm(PAPER_PROMPT.format(title=title, abstract=abstract))
    parsed = parse_json_safe(raw)
    if not parsed:
        return None
    return {
        "chinese_title":          parsed.get("chinese_title", ""),
        "chinese_summary":        parsed.get("chinese_summary", ""),
        "pain_point":             parsed.get("pain_point", ""),
        "core_value":             parsed.get("core_value", ""),
        "technical_architecture": parsed.get("technical_architecture", ""),
        "quantitative_results":   parsed.get("quantitative_results", ""),
        "competitors":            parsed.get("competitors", ""),
        "limitations":            parsed.get("limitations", ""),
        "key_contributions":      parsed.get("key_contributions", []),
        "application_scenarios":  parsed.get("application_scenarios", []),
        "technical_highlights":   parsed.get("technical_highlights", []),
        "model_used":             OPENAI_MODEL,
    }

# ===== 核心：补充指定文件的摘要 =====
def fill_summaries_for_date(date_str):
    json_file = DAILY_DIR / f"{date_str}.json"
    if not json_file.exists():
        log(f"⚠️  {date_str}.json 不存在，跳过")
        return

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    papers = data.get("papers", [])
    pending = [p for p in papers if not p.get("structured_summary")]

    if not pending:
        log(f"✅ {date_str}: 所有论文已有 AI 分析，无需补充")
        return

    log(f"\n📅 {date_str}: 共 {len(papers)} 篇，待补充 AI 分析: {len(pending)} 篇")
    success = 0

    for i, paper in enumerate(pending):
        try:
            summary = generate_summary(paper)
            if summary and summary.get("chinese_summary"):
                paper["structured_summary"] = summary
                success += 1
                log(f"  [{i+1}/{len(pending)}] ✓ {paper['title'][:55]}")
            else:
                log(f"  [{i+1}/{len(pending)}] ✗ AI 分析为空: {paper['title'][:40]}")
        except Exception as e:
            log(f"  [{i+1}/{len(pending)}] ✗ 异常: {e}")

        if i < len(pending) - 1:
            time.sleep(REQUEST_INTERVAL)

    log(f"  AI 分析完成: {success}/{len(pending)} 篇成功")

    # 回写文件（只更新 papers 和 generated_at，保留其他字段）
    data["papers"] = papers
    data["generated_at"] = datetime.now(timezone.utc).isoformat()
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log(f"💾 已更新: {json_file}")

# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(description="为现有 daily JSON 补充 AI 摘要")
    parser.add_argument(
        "--dates", nargs="+",
        help="指定日期列表（YYYY-MM-DD），不填则处理所有缺少摘要的文件"
    )
    args = parser.parse_args()

    if not OPENAI_API_KEY:
        log("❌ 未配置 OPENAI_API_KEY，请先在 .env 文件中填写密钥")
        sys.exit(1)

    log(f"=== AI Papers Daily - 补充 AI 摘要任务 ===")
    log(f"使用模型: {OPENAI_MODEL}")

    if args.dates:
        dates = args.dates
    else:
        # 自动扫描所有缺少摘要的文件
        dates = []
        for f in sorted(DAILY_DIR.glob("*.json")):
            if f.name == "index.json":
                continue
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    d = json.load(fp)
                pending = sum(1 for p in d.get("papers", []) if not p.get("structured_summary"))
                if pending > 0:
                    dates.append(f.stem)
                    log(f"  发现 {f.stem}: {pending} 篇待补充")
            except Exception:
                pass

    if not dates:
        log("✅ 所有文件均已有完整 AI 分析，无需补充")
        return

    log(f"待处理日期: {', '.join(dates)}\n")
    for date_str in dates:
        fill_summaries_for_date(date_str)

    log(f"\n=== 补充任务完成 ===")

if __name__ == "__main__":
    main()
