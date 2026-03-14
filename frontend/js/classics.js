/**
 * 经典论文页逻辑
 * 纯静态方案：从历史数据中筛选高热度论文作为"经典"
 */

(function () {
  const $ = id => document.getElementById(id);

  // ===== 状态 =====
  let allClassics = [];       // 全部经典论文
  let filteredClassics = [];  // 筛选后
  let displayCount = 15;
  const PAGE_SIZE = 15;
  let currentDomain = 'all';
  let currentSort = 'hot_score';

  // 各领域计数
  const domainCounts = {};

  // ===== 初始化 =====
  async function init() {
    await loadClassics();
    setupEventListeners();
  }

  // ===== 加载经典论文 =====
  // 策略：从 data/classics.json 加载（如存在），否则从历史数据中取热度最高的论文
  async function loadClassics() {
    try {
      // 优先尝试加载专门的经典论文文件
      let papers = [];
      try {
        const data = await API.getClassicPapers();
        papers = data.papers || [];
      } catch (e) {
        // 降级：从历史数据中聚合热度最高的论文
        papers = await loadFromHistory();
      }

      allClassics = papers;

      // 统计各领域数量
      const cats = ['llm', 'multimodal', 'cv', 'rl', 'recsys', 'other'];
      cats.forEach(c => { domainCounts[c] = 0; });
      papers.forEach(p => {
        // agent/nlp 合并到 llm
        const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : (p.category || 'other');
        if (domainCounts[cat] !== undefined) domainCounts[cat]++;
        else domainCounts['other']++;
      });
      domainCounts['all'] = papers.length;

      // 更新侧边栏计数
      updateDomainCounts();

      applyFilterAndRender();
    } catch (err) {
      console.error('加载经典论文失败:', err);
      $('loadingState').classList.add('hidden');
      $('emptyState').classList.remove('hidden');
      $('classicsSubtitle').textContent = '加载失败，请刷新重试';
    }
  }

  // ===== 从历史数据中聚合经典论文 =====
  async function loadFromHistory() {
    const index = await API.getDates();
    const dates = (index.dates || []).slice(0, 30); // 最近30天
    const allPapers = [];

    for (const { date } of dates) {
      try {
        const data = await API.getDailyPapers(date);
        allPapers.push(...(data.papers || []));
      } catch (e) {
        // 跳过
      }
    }

    // 去重（按 paper_id）
    const seen = new Set();
    const unique = allPapers.filter(p => {
      if (seen.has(p.paper_id)) return false;
      seen.add(p.paper_id);
      return true;
    });

    // 取热度最高的前 100 篇作为"经典"
    unique.sort((a, b) => (b.hot_score || 0) - (a.hot_score || 0));
    return unique.slice(0, 100);
  }

  // ===== 更新侧边栏领域计数 =====
  function updateDomainCounts() {
    document.querySelectorAll('.domain-btn').forEach(btn => {
      const domain = btn.dataset.domain;
      const countEl = btn.querySelector('.domain-count');
      if (countEl && domainCounts[domain] !== undefined) {
        countEl.textContent = domainCounts[domain];
      }
    });
  }

  // ===== 筛选 + 排序 + 渲染 =====
  function applyFilterAndRender() {
    filteredClassics = currentDomain === 'all'
      ? [...allClassics]
      : allClassics.filter(p => {
          const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : (p.category || 'other');
          return cat === currentDomain;
        });

    const sortFns = {
      hot_score: (a, b) => (b.hot_score || 0) - (a.hot_score || 0),
      upvotes:   (a, b) => (b.upvotes || 0) - (a.upvotes || 0),
      date:      (a, b) => new Date(b.published_date) - new Date(a.published_date),
    };
    filteredClassics.sort(sortFns[currentSort] || sortFns.hot_score);

    displayCount = PAGE_SIZE;
    renderPapers();
  }

  // ===== 渲染论文列表 =====
  function renderPapers() {
    $('loadingState').classList.add('hidden');
    const paperList = $('paperList');
    paperList.innerHTML = '';

    // 更新标题
    const domainLabels = {
      all: '全部经典论文', llm: '大模型 LLM 经典论文',
      multimodal: '多模态经典论文',
      cv: '计算机视觉经典论文',
      rl: '强化学习经典论文', recsys: '搜广推经典论文',
    };
    $('classicsTitle').textContent = domainLabels[currentDomain] || '经典论文';
    $('classicsSubtitle').textContent = `共 ${filteredClassics.length} 篇精选经典论文`;

    const toShow = filteredClassics.slice(0, displayCount);

    if (toShow.length === 0) {
      $('emptyState').classList.remove('hidden');
      $('loadMoreWrap').classList.add('hidden');
      return;
    }

    $('emptyState').classList.add('hidden');
    toShow.forEach(paper => renderPaperCard(paper, paperList));

    const hasMore = displayCount < filteredClassics.length;
    $('loadMoreWrap').classList.toggle('hidden', !hasMore);
  }

  // ===== 切换领域 =====
  function switchDomain(domain) {
    currentDomain = domain;

    // 更新桌面端导航高亮
    document.querySelectorAll('.domain-btn').forEach(btn => {
      const isActive = btn.dataset.domain === domain;
      btn.classList.toggle('text-primary', isActive);
      btn.classList.toggle('bg-blue-50', isActive);
      btn.classList.toggle('text-gray-600', !isActive);
    });

    // 更新移动端筛选高亮
    document.querySelectorAll('#mobileDomainFilter .cat-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.domain === domain);
    });

    applyFilterAndRender();
  }

  // ===== 事件监听 =====
  function setupEventListeners() {
    // 桌面端领域导航
    const domainNav = $('domainNav');
    if (domainNav) {
      domainNav.addEventListener('click', e => {
        const btn = e.target.closest('.domain-btn');
        if (!btn) return;
        switchDomain(btn.dataset.domain);
      });
    }

    // 移动端领域筛选
    const mobileDomainFilter = $('mobileDomainFilter');
    if (mobileDomainFilter) {
      mobileDomainFilter.addEventListener('click', e => {
        const tab = e.target.closest('.cat-tab');
        if (!tab) return;
        switchDomain(tab.dataset.domain);
      });
    }

    // 排序
    $('sortSelect').addEventListener('change', e => {
      currentSort = e.target.value;
      applyFilterAndRender();
    });

    // 加载更多
    $('btnLoadMore').addEventListener('click', () => {
      displayCount += PAGE_SIZE;
      renderPapers();
    });

    // Header 搜索
    const headerSearch = $('headerSearch');
    if (headerSearch) {
      headerSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.value.trim()) {
          window.location.href = `history.html?q=${encodeURIComponent(e.target.value.trim())}`;
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
