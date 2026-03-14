#!/usr/bin/env python3
"""
AI Papers Daily - 论文采集与摘要生成脚本
运行方式：python scripts/fetch_papers.py
输出：data/daily/YYYY-MM-DD.json 和更新 data/index.json
"""

import os
import json
import time
import re
import ssl
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ===== 自动加载 .env 文件（本地开发用，生产环境用 GitHub Secrets）=====
def _load_dotenv():
    """读取脚本同级或项目根目录的 .env 文件，将变量注入环境（不覆盖已有环境变量）"""
    script_dir = Path(__file__).parent
    candidates = [script_dir / ".env", script_dir.parent / ".env"]
    for env_file in candidates:
        if env_file.exists():
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:  # 不覆盖已有环境变量
                        os.environ[key] = val
            break  # 找到第一个就停止

_load_dotenv()

# ===== SSL 修复（解决 macOS 证书问题）=====
# 优先使用 certifi 证书，否则降级为不验证（仅本地开发用）
try:
    import certifi
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = ssl._create_unverified_context()

# ===== 配置 =====
ARXIV_CATEGORIES = os.getenv("ARXIV_CATEGORIES", "cs.CL,cs.AI,cs.LG,cs.CV,cs.IR").split(",")
ARXIV_MAX_RESULTS = int(os.getenv("ARXIV_MAX_RESULTS", "30"))  # arXiv 备用采集数量
HF_MAX_RESULTS = int(os.getenv("HF_MAX_RESULTS", "10"))        # HuggingFace 精选数量（主要来源）
DAILY_TARGET = int(os.getenv("DAILY_TARGET", "10"))            # 每日目标推送篇数
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "Qwen/Qwen2.5-7B-Instruct")
REQUEST_INTERVAL = float(os.getenv("REQUEST_INTERVAL", "1"))  # SiliconFlow 限速宽松，1 秒间隔即可
MAX_RETRY = int(os.getenv("MAX_RETRY", "3"))  # 429 限速时最大重试次数

DATA_DIR = Path(__file__).parent.parent / "data"
DAILY_DIR = DATA_DIR / "daily"
INDEX_FILE = DATA_DIR / "index.json"

# ===== 工具函数 =====

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    req.add_header("User-Agent", "AI-Papers-Daily/1.0 (https://github.com/ai-papers-daily)")
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

def map_arxiv_category(cats):
    """将 arXiv 分类映射到网站分类
    注意：大模型、Agent、NLP 三个方向统一合并为 "llm"（大模型）
    """
    cats = cats if isinstance(cats, list) else [cats]
    # cs.CL(NLP)、cs.AI(AI/Agent)、cs.LG(机器学习/大模型) 全部归入大模型
    if any(c in ["cs.CL", "cs.AI", "cs.LG", "cs.MA", "cs.NE"] for c in cats): return "llm"
    if "cs.CV" in cats: return "cv"
    if "cs.IR" in cats: return "recsys"
    if "cs.RO" in cats: return "rl"
    return "other"

# ===== arXiv 采集 =====

def fetch_arxiv():
    log("📄 开始采集 arXiv...")
    query = "+OR+".join(f"cat:{c}" for c in ARXIV_CATEGORIES)
    url = (
        f"https://export.arxiv.org/api/query"
        f"?search_query={query}"
        f"&sortBy=submittedDate&sortOrder=descending"
        f"&max_results={ARXIV_MAX_RESULTS}"
    )
    items = []
    try:
        xml_text = http_get(url, timeout=30)
        root = ET.fromstring(xml_text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        for entry in root.findall("atom:entry", ns):
            try:
                raw_id = entry.find("atom:id", ns).text or ""
                arxiv_id = raw_id.replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "").strip()

                authors = [
                    a.find("atom:name", ns).text
                    for a in entry.findall("atom:author", ns)
                    if a.find("atom:name", ns) is not None
                ]

                cats = [
                    c.get("term", "")
                    for c in entry.findall("atom:category", ns)
                ]

                title = (entry.find("atom:title", ns).text or "").replace("\n", " ").strip()
                abstract = (entry.find("atom:summary", ns).text or "").replace("\n", " ").strip()
                published = entry.find("atom:published", ns).text or ""

                items.append({
                    "paper_id": f"arxiv-{arxiv_id}",
                    "source": "arxiv",
                    "title": title,
                    "authors": authors,
                    "abstract": abstract,
                    "published_date": published,
                    "url": f"https://arxiv.org/abs/{arxiv_id}",
                    "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
                    "code_url": None,
                    "hf_url": None,
                    "category": map_arxiv_category(cats),
                    "tags": cats[:5],
                    "upvotes": 0,
                    "hot_score": 0,
                    "structured_summary": None,
                })
            except Exception as e:
                log(f"  解析条目失败: {e}")

        log(f"  arXiv: 获取 {len(items)} 篇")
    except Exception as e:
        log(f"  arXiv 采集失败: {e}")
    return items

# ===== HuggingFace Daily Papers =====

def _get_arxiv_cats_batch(arxiv_ids):
    """批量通过 arXiv API 查询多篇论文的真实分类，返回 {arxiv_id: [cats]} 字典"""
    if not arxiv_ids:
        return {}
    id_list = ",".join(arxiv_ids)
    url = f"https://export.arxiv.org/api/query?id_list={id_list}&max_results={len(arxiv_ids)}"
    # 遇到 429 限流时，最多重试 3 次，等待时间依次为 30s / 60s / 90s
    for attempt in range(3):
        try:
            xml_text = http_get(url, timeout=30)
            root = ET.fromstring(xml_text)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            result = {}
            for entry in root.findall("atom:entry", ns):
                raw_id = (entry.find("atom:id", ns).text or "").strip()
                arxiv_id = raw_id.replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "").strip()
                # 去掉版本号 v1/v2 等
                arxiv_id = re.sub(r"v\d+$", "", arxiv_id)
                cats = [c.get("term", "") for c in entry.findall("atom:category", ns) if c.get("term")]
                result[arxiv_id] = cats
            return result
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = (attempt + 1) * 30  # 30s / 60s / 90s
                log(f"  ⏳ arXiv 限流(429)，等待 {wait}s 后重试 ({attempt+1}/3)...")
                time.sleep(wait)
            else:
                log(f"  批量查询 arXiv 分类失败: {e}")
                return {}
        except Exception as e:
            log(f"  批量查询 arXiv 分类失败: {e}")
            return {}
    log("  ⚠️  arXiv 分类查询多次限流，放弃，使用兜底分类")
    return {}

def fetch_huggingface():
    log("🤗 开始采集 HuggingFace Daily Papers...")
    items = []
    try:
        headers = {}
        if HF_API_TOKEN:
            headers["Authorization"] = f"Bearer {HF_API_TOKEN}"
        text = http_get("https://huggingface.co/api/daily_papers", headers=headers, timeout=20)
        papers = json.loads(text)
        if not isinstance(papers, list):
            papers = papers.get("papers", [])

        # 第一步：解析基础字段，收集所有 arxiv_id
        raw_items = []
        for paper in papers:
            try:
                p = paper.get("paper", paper)
                arxiv_id = p.get("id", "")
                authors = [
                    a.get("name", a) if isinstance(a, dict) else str(a)
                    for a in (p.get("authors") or [])
                ]
                # upvotes 在 paper 内层（不在外层）
                upvotes = p.get("upvotes", 0) or 0
                hot_score = upvotes * 10 + (p.get("likes", 0) or 0)
                raw_items.append({
                    "arxiv_id": arxiv_id,
                    "upvotes": upvotes,
                    "hot_score": hot_score,
                    "title": p.get("title", ""),
                    "authors": authors,
                    "abstract": p.get("summary", p.get("abstract", "")),
                    "published_date": p.get("publishedAt", paper.get("publishedAt", "")),
                })
            except Exception as e:
                log(f"  解析 HF 论文失败: {e}")

        # 第二步：先按热度排序，只取 TOP N，再批量查询 arXiv 分类（减少请求量）
        raw_items.sort(key=lambda x: x["hot_score"], reverse=True)
        top_items = raw_items[:HF_MAX_RESULTS]
        arxiv_ids = [r["arxiv_id"] for r in top_items if r["arxiv_id"]]
        log(f"  批量查询 arXiv 分类: {len(arxiv_ids)} 篇...")
        cats_map = _get_arxiv_cats_batch(arxiv_ids)

        # 第三步：组装最终数据
        for r in top_items:
            arxiv_id = r["arxiv_id"]
            arxiv_cats = cats_map.get(arxiv_id, [])
            category = map_arxiv_category(arxiv_cats) if arxiv_cats else "llm"
            items.append({
                "paper_id": f"hf-paper-{arxiv_id}",
                "source": "huggingface",
                "title": r["title"],
                "authors": r["authors"],
                "abstract": r["abstract"],
                "published_date": r["published_date"],
                "url": f"https://arxiv.org/abs/{arxiv_id}",
                "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
                "code_url": None,
                "hf_url": f"https://huggingface.co/papers/{arxiv_id}",
                "category": category,
                "tags": arxiv_cats[:5],
                "upvotes": r["upvotes"],
                "hot_score": r["hot_score"],
                "structured_summary": None,
            })

        log(f"  HuggingFace: 精选 {len(items)} 篇（按热度排序）")
    except Exception as e:
        log(f"  HuggingFace 采集失败: {e}")
    return items

# ===== 去重 =====

def deduplicate(items):
    seen = set()
    result = []
    for item in items:
        pid = item["paper_id"]
        if pid not in seen:
            seen.add(pid)
            result.append(item)
    return result

# ===== AI 摘要生成 =====

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
    """调用 OpenAI 兼容 API，支持 429 限速自动重试（指数退避）"""
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
        """带重试的请求，遇到 429 自动等待后重试"""
        for attempt in range(MAX_RETRY):
            try:
                resp = http_post_json(url, p, headers)
                return resp["choices"][0]["message"]["content"].strip()
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    wait = (attempt + 1) * 15  # 15s / 30s / 45s 指数退避
                    log(f"    ⏳ 触发限速(429)，等待 {wait}s 后重试 ({attempt+1}/{MAX_RETRY})...")
                    time.sleep(wait)
                else:
                    raise
        return None

    # 尝试带 response_format
    try:
        result = _do_request({**payload, "response_format": {"type": "json_object"}})
        if result:
            return result
    except Exception:
        pass

    # 降级：不带 response_format
    try:
        result = _do_request(payload)
        if result:
            return result
    except Exception as e:
        log(f"    LLM 调用失败: {e}")

    return None

def parse_json_safe(text):
    if not text:
        return None
    text = text.strip()
    # 去掉 markdown 代码块
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except Exception:
        # 尝试提取 JSON 对象
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return None

def generate_summary(paper):
    """为单篇论文生成结构化摘要"""
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
    """批量生成摘要 —— 每篇论文都必须生成 AI 分析"""
    if not OPENAI_API_KEY:
        log("⚠️  未配置 OPENAI_API_KEY，跳过摘要生成")
        return papers

    # 只处理还没有摘要的论文（支持断点续跑）
    pending = [p for p in papers if not p.get("structured_summary")]
    log(f"🤖 开始生成 AI 分析: {len(pending)} 篇（共 {len(papers)} 篇，已有摘要 {len(papers)-len(pending)} 篇）")
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

# ===== 保存数据 =====

def save_daily_data(papers, date_str):
    """保存每日数据到 JSON 文件（强制覆盖，确保数据来自真实采集）"""
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    output_file = DAILY_DIR / f"{date_str}.json"

    # 注意：不合并旧数据，每次直接覆盖，防止历史假数据残留
    # 按热度排序
    papers.sort(key=lambda p: p.get("hot_score", 0), reverse=True)

    data = {
        "date": date_str,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(papers),
        "papers": papers,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    log(f"💾 已保存: {output_file} ({len(papers)} 篇，来源：真实采集)")
    return len(papers)

def update_index(date_str, total):
    """更新 data/index.json"""
    index = {"updated_at": "", "dates": [], "total_papers": 0}
    if INDEX_FILE.exists():
        try:
            with open(INDEX_FILE, "r", encoding="utf-8") as f:
                index = json.load(f)
        except Exception:
            pass

    # 更新或插入当天记录
    dates = index.get("dates", [])
    found = False
    for d in dates:
        if d["date"] == date_str:
            d["total"] = total
            found = True
            break
    if not found:
        dates.insert(0, {"date": date_str, "total": total})

    # 按日期降序排序，保留最近 90 天
    dates.sort(key=lambda d: d["date"], reverse=True)
    dates = dates[:90]

    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    index["dates"] = dates
    index["total_papers"] = sum(d["total"] for d in dates)

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    log(f"📋 已更新索引: {len(dates)} 个日期")

# ===== 主流程 =====

def main():
    # 使用北京时间（UTC+8）作为日期基准，避免跨天时文件名错误
    beijing_tz = timezone(timedelta(hours=8))
    today = datetime.now(beijing_tz).strftime("%Y-%m-%d")
    log(f"=== AI Papers Daily 采集任务开始 ({today}) ===")

    # 1. 采集论文
    # 第一步：优先从 HuggingFace 获取精选论文（人工筛选，质量高）
    hf_papers = fetch_huggingface()  # 已在函数内限制为 HF_MAX_RESULTS 篇

    # 第二步：如果 HF 论文不足 DAILY_TARGET 篇，从 arXiv 补充
    papers = list(hf_papers)
    if len(papers) < DAILY_TARGET:
        need = DAILY_TARGET - len(papers)
        log(f"📄 HF 论文不足 {DAILY_TARGET} 篇，从 arXiv 补充 {need} 篇...")
        arxiv_papers = fetch_arxiv()
        # 去重后补充
        existing_ids = {p["paper_id"] for p in papers}
        for p in arxiv_papers:
            if p["paper_id"] not in existing_ids and len(papers) < DAILY_TARGET:
                papers.append(p)
                existing_ids.add(p["paper_id"])
        log(f"📊 最终采集: HF {len(hf_papers)} 篇 + arXiv补充 {len(papers)-len(hf_papers)} 篇 = 共 {len(papers)} 篇")
    else:
        log(f"📊 HuggingFace 精选: {len(papers)} 篇（无需 arXiv 补充）")

    if not papers:
        log("⚠️  未采集到任何论文，退出")
        return

    # 2. 生成 AI 摘要
    papers = generate_batch_summaries(papers)

    # 3. 保存数据
    total = save_daily_data(papers, today)
    update_index(today, total)

    log(f"=== 任务完成 ===")

if __name__ == "__main__":
    main()
