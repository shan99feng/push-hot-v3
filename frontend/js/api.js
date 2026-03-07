/**
 * 数据访问层
 * 纯静态方案：直接读取 data/ 目录下的 JSON 文件
 * 无需任何后端服务器或数据库
 */

// 数据根路径：自动适配本地开发和 GitHub Pages 部署
// - GitHub Pages 部署后 data/ 与 HTML 同级（deploy_pages.yml 会 cp data 到 frontend/）
// - 本地直接打开 HTML 文件时，data/ 在上级目录
const DATA_BASE = (() => {
  // 如果当前页面路径包含 /frontend/，说明是本地开发环境
  const path = window.location.pathname;
  if (path.includes('/frontend/')) return '../data';
  // GitHub Pages 或其他部署环境：data 与 HTML 同级
  return 'data';
})();

// 简单内存缓存，避免重复请求同一文件
const _cache = new Map();

async function fetchJSON(url) {
  if (_cache.has(url)) return _cache.get(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const data = await resp.json();
  _cache.set(url, data);
  return data;
}

const API = {
  /**
   * 获取日期索引（所有有数据的日期列表）
   */
  async getDates() {
    return fetchJSON(`${DATA_BASE}/index.json`);
  },

  /**
   * 获取指定日期的论文列表
   * @param {string} date - YYYY-MM-DD
   */
  async getDailyPapers(date) {
    return fetchJSON(`${DATA_BASE}/daily/${date}.json`);
  },

  /**
   * 获取今日论文（自动取最新日期）
   */
  async getTodayPapers() {
    const index = await this.getDates();
    if (!index.dates || index.dates.length === 0) {
      return { date: '', total: 0, papers: [] };
    }
    const latestDate = index.dates[0].date;
    return this.getDailyPapers(latestDate);
  },

  /**
   * 获取单篇论文详情（先查 classics.json，再查每日数据）
   * @param {string} paperId
   */
  async getPaperById(paperId) {
    // 1. 优先从经典论文库中查找
    try {
      const classicsData = await fetchJSON(`${DATA_BASE}/classics.json`);
      const paper = (classicsData.papers || []).find(p => p.paper_id === paperId);
      if (paper) return paper;
    } catch (e) {
      // classics.json 不存在时跳过
    }

    // 2. 再从每日数据中查找（最近 30 天）
    const index = await this.getDates();
    for (const { date } of (index.dates || []).slice(0, 30)) {
      try {
        const dayData = await this.getDailyPapers(date);
        const paper = (dayData.papers || []).find(p => p.paper_id === paperId);
        if (paper) return paper;
      } catch (e) {
        // 该日期文件不存在，跳过
      }
    }
    throw new Error('论文不存在');
  },

  /**
   * 搜索论文（按 今日推荐 → 历史论文 → 经典论文 顺序返回）
   * @param {string} q - 关键词
   * @param {number} maxDays - 最多搜索最近多少天（历史部分）
   * @returns {{ total, papers, todayResults, historyResults, classicsResults }}
   */
  async searchPapers(q, maxDays = 30) {
    const keyword = q.toLowerCase();
    const seenIds = new Set();

    // 辅助：判断一篇论文是否匹配关键词
    function matches(paper) {
      return (
        (paper.title || '').toLowerCase().includes(keyword) ||
        (paper.abstract || '').toLowerCase().includes(keyword) ||
        (paper.authors || []).some(a => a.toLowerCase().includes(keyword)) ||
        (paper.structured_summary?.chinese_title || '').includes(q) ||
        (paper.structured_summary?.chinese_summary || '').includes(q)
      );
    }

    const todayResults = [];
    const historyResults = [];
    const classicsResults = [];

    // 1. 先搜索今日论文（最新一天）
    try {
      const todayData = await this.getTodayPapers();
      const todayDate = todayData.date;
      for (const paper of (todayData.papers || [])) {
        if (matches(paper) && !seenIds.has(paper.paper_id)) {
          seenIds.add(paper.paper_id);
          todayResults.push({ ...paper, _search_source: 'today' });
        }
      }

      // 2. 再搜索历史论文（跳过今日，最多 maxDays 天）
      const index = await this.getDates();
      for (const { date } of (index.dates || []).slice(0, maxDays)) {
        if (date === todayDate) continue; // 今日已搜过
        try {
          const dayData = await this.getDailyPapers(date);
          for (const paper of (dayData.papers || [])) {
            if (matches(paper) && !seenIds.has(paper.paper_id)) {
              seenIds.add(paper.paper_id);
              historyResults.push({ ...paper, _search_source: 'history' });
            }
          }
        } catch (e) { /* 跳过 */ }
      }
    } catch (e) { /* 跳过 */ }

    // 3. 最后搜索经典论文库（classics.json）
    try {
      const classicsData = await fetchJSON(`${DATA_BASE}/classics.json`);
      for (const paper of (classicsData.papers || [])) {
        if (matches(paper) && !seenIds.has(paper.paper_id)) {
          seenIds.add(paper.paper_id);
          classicsResults.push({ ...paper, _search_source: 'classics' });
        }
      }
    } catch (e) { /* classics.json 不存在时跳过 */ }

    // 各分组内按热度排序
    const byHot = (a, b) => (b.hot_score || 0) - (a.hot_score || 0);
    todayResults.sort(byHot);
    historyResults.sort(byHot);
    classicsResults.sort(byHot);

    // 合并：今日 → 历史 → 经典
    const papers = [...todayResults, ...historyResults, ...classicsResults];
    return {
      total: papers.length,
      papers,
      todayResults,
      historyResults,
      classicsResults,
    };
  },

  /**
   * 获取经典论文
   * 优先读取独立的 classics.json 文件，若不存在则从每日数据中筛选 is_classic=true
   * @param {string} domain - 领域筛选（all / llm / multimodal / cv / rl / recsys）
   */
  async getClassicPapers(domain = 'all') {
    // 优先读取独立经典论文文件
    try {
      const data = await fetchJSON(`${DATA_BASE}/classics.json`);
      let papers = data.papers || [];
      if (domain !== 'all') {
        papers = papers.filter(p => p.category === domain);
      }
      papers.sort((a, b) => (b.hot_score || 0) - (a.hot_score || 0));
      return {
        total: papers.length,
        papers,
        categories: data.categories || {},
        description: data.description || '',
      };
    } catch (e) {
      // classics.json 不存在时，降级从每日数据中筛选
    }

    const index = await this.getDates();
    const results = [];
    for (const { date } of (index.dates || [])) {
      try {
        const dayData = await this.getDailyPapers(date);
        for (const paper of (dayData.papers || [])) {
          if (paper.is_classic) {
            if (domain === 'all' || paper.category === domain) {
              results.push(paper);
            }
          }
        }
      } catch (e) {
        // 跳过
      }
    }
    results.sort((a, b) => (b.hot_score || 0) - (a.hot_score || 0));
    return { total: results.length, papers: results };
  },
};
