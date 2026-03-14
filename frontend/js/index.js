/**
 * 首页逻辑 - 读取 JSON 文件，无需后端
 */

(function () {
  const $ = id => document.getElementById(id);

  // ===== 状态 =====
  let allPapers = [];       // 当天全部论文
  let filteredPapers = [];  // 筛选后的论文
  let displayCount = 15;    // 当前显示数量
  const PAGE_SIZE = 15;

  let currentCategory = 'all';
  let currentSort = 'hot_score';

  // ===== 初始化 =====
  async function init() {
    setupEventListeners();
    await Promise.all([loadTodayPapers(), loadDateNav()]);
  }

  // ===== 加载今日论文 =====
  async function loadTodayPapers() {
    showLoading(true);
    try {
      const data = await API.getTodayPapers();
      allPapers = data.papers || [];

      // 更新页面标题
      const d = new Date(data.date);
      const dateStr = isNaN(d) ? data.date : d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
      $('pageSubtitle').textContent = `${dateStr} · 共 ${data.total} 篇论文`;
      $('updateTime').textContent = `更新于 ${dateStr}`;

      // 更新侧边栏统计
      updateSidebarStats(allPapers);

      applyFilterAndRender();
    } catch (err) {
      console.error('加载今日论文失败:', err);
      showLoading(false);
      showEmpty(true);
      $('pageSubtitle').textContent = '暂无数据，请稍后再试';
    }
  }

  // ===== 加载日期导航 =====
  async function loadDateNav() {
    try {
      const index = await API.getDates();
      const dates = index.dates || [];
      const dateNav = $('dateNav');
      if (!dateNav) return;

      if (dates.length === 0) {
        dateNav.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">暂无历史数据</div>';
        return;
      }

      dateNav.innerHTML = '';
      dates.slice(0, 30).forEach(item => {
        const a = document.createElement('a');
        a.href = `history.html?date=${item.date}`;
        a.className = 'date-nav-item';
        a.innerHTML = `<span>${item.date}</span><span class="date-count">${item.total}</span>`;
        dateNav.appendChild(a);
      });
    } catch (err) {
      const dateNav = $('dateNav');
      if (dateNav) dateNav.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">加载失败</div>';
    }
  }

  // ===== 更新侧边栏统计 =====
  function updateSidebarStats(papers) {
    const counts = { llm: 0, multimodal: 0, cv: 0, recsys: 0, rl: 0 };
    papers.forEach(p => {
      const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : p.category;
      if (counts[cat] !== undefined) counts[cat]++;
    });
    const s = id => $(id);
    if (s('statTotal'))     s('statTotal').textContent     = papers.length;
    if (s('statLLM'))       s('statLLM').textContent       = counts.llm;
    if (s('statMultimodal'))s('statMultimodal').textContent= counts.multimodal;
    if (s('statCV'))        s('statCV').textContent        = counts.cv;
    if (s('statRecsys'))    s('statRecsys').textContent    = counts.recsys;
    if (s('statRL'))        s('statRL').textContent        = counts.rl;
  }

  // ===== 筛选 + 排序 + 渲染 =====
  function applyFilterAndRender() {
    // 筛选
    filteredPapers = currentCategory === 'all'
      ? [...allPapers]
      : allPapers.filter(p => {
          const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : (p.category || 'other');
          return cat === currentCategory;
        });

    // 排序
    const sortFns = {
      hot_score: (a, b) => (b.hot_score || 0) - (a.hot_score || 0),
      upvotes:   (a, b) => (b.upvotes || 0) - (a.upvotes || 0),
      date:      (a, b) => new Date(b.published_date) - new Date(a.published_date),
    };
    filteredPapers.sort(sortFns[currentSort] || sortFns.hot_score);

    // 重置显示数量
    displayCount = PAGE_SIZE;

    renderPapers();
    updateStats();
  }

  // ===== 渲染论文列表 =====
  function renderPapers() {
    showLoading(false);
    const paperList = $('paperList');
    paperList.innerHTML = '';

    const toShow = filteredPapers.slice(0, displayCount);

    if (toShow.length === 0) {
      showEmpty(true);
      $('loadMoreWrap').classList.add('hidden');
      return;
    }

    showEmpty(false);
    toShow.forEach(paper => renderPaperCard(paper, paperList));

    // 加载更多按钮
    const hasMore = displayCount < filteredPapers.length;
    $('loadMoreWrap').classList.toggle('hidden', !hasMore);
  }

  // ===== 更新统计信息 =====
  function updateStats() {
    const catLabel = currentCategory === 'all' ? '全部分类' : getCategoryLabel(currentCategory);
    $('statsText').textContent = `${catLabel} · 共 ${filteredPapers.length} 篇`;
  }

  // ===== 显示/隐藏状态 =====
  function showLoading(show) {
    $('loadingState').classList.toggle('hidden', !show);
  }
  function showEmpty(show) {
    $('emptyState').classList.toggle('hidden', !show);
  }

  // ===== 事件监听 =====
  function setupEventListeners() {
    // 分类筛选
    $('categoryFilter').addEventListener('click', e => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.category;
      applyFilterAndRender();
    });

    // 排序
    $('sortSelect').addEventListener('change', e => {
      currentSort = e.target.value;
      applyFilterAndRender();
    });

    // 今日统计分类点击 → 触发主内容区筛选
    $('sidebarStats').addEventListener('click', e => {
      const row = e.target.closest('[data-stat-cat]');
      if (!row) return;
      const cat = row.dataset.statCat;
      // 同步顶部筛选栏 active 状态
      $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === cat);
      });
      currentCategory = cat;
      applyFilterAndRender();
      // 滚动到论文列表
      $('paperList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // 刷新
    $('btnRefresh').addEventListener('click', () => {
      const icon = $('refreshIcon');
      icon.classList.add('fa-spin');
      setTimeout(() => icon.classList.remove('fa-spin'), 1000);
      // 清除缓存后重新加载
      _cache.clear();
      allPapers = [];
      loadTodayPapers();
    });

    // 加载更多
    $('btnLoadMore').addEventListener('click', () => {
      displayCount += PAGE_SIZE;
      renderPapers();
    });

    // Header 搜索框 - 点击打开搜索浮层
    $('headerSearch').addEventListener('focus', openSearch);
    $('headerSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) window.location.href = `history.html?q=${encodeURIComponent(q)}`;
      }
    });

    // 移动端搜索
    const mobileSearch = $('mobileSearch');
    if (mobileSearch) {
      mobileSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const q = e.target.value.trim();
          if (q) window.location.href = `history.html?q=${encodeURIComponent(q)}`;
        }
      });
    }

    // 搜索浮层
    $('searchClose').addEventListener('click', closeSearch);
    $('searchOverlay').addEventListener('click', e => {
      if (e.target === $('searchOverlay')) closeSearch();
    });
    $('searchInput').addEventListener('input', debounce(handleSearch, 400));
    $('searchInput').addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSearch();
    });
  }

  // ===== 搜索浮层 =====
  function openSearch() {
    $('searchOverlay').classList.remove('hidden');
    $('searchInput').focus();
  }

  function closeSearch() {
    $('searchOverlay').classList.add('hidden');
    $('searchInput').value = '';
    $('searchResults').innerHTML = '<div class="text-center text-gray-400 text-sm py-8">输入关键词开始搜索</div>';
  }

  async function handleSearch(e) {
    const q = e.target.value.trim();
    const resultsEl = $('searchResults');
    if (q.length < 2) {
      resultsEl.innerHTML = '<div class="text-center text-gray-400 text-sm py-8">输入关键词开始搜索</div>';
      return;
    }

    resultsEl.innerHTML = '<div class="text-center text-gray-400 text-sm py-4"><div class="loading-spinner mx-auto mb-2"></div>搜索中...</div>';

    try {
      const data = await API.searchPapers(q, 30);
      const { todayResults = [], historyResults = [], classicsResults = [] } = data;
      const total = data.total;

      if (total === 0) {
        resultsEl.innerHTML = `<div class="text-center text-gray-400 text-sm py-8">未找到"${q}"相关论文</div>`;
        return;
      }

      resultsEl.innerHTML = '';

      // 渲染一个分组
      function renderGroup(papers, groupLabel, groupIcon, maxShow) {
        if (papers.length === 0) return;
        // 分组标题
        const header = document.createElement('div');
        header.className = 'flex items-center gap-1.5 px-1 pt-1 pb-0.5';
        header.innerHTML = `<i class="fa ${groupIcon} text-xs text-gray-400"></i><span class="text-xs font-semibold text-gray-400 uppercase tracking-wide">${groupLabel}</span><span class="text-xs text-gray-300 ml-1">${papers.length} 篇</span>`;
        resultsEl.appendChild(header);

        papers.slice(0, maxShow).forEach(paper => {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="badge source-badge ${getSourceClass(paper.source)}">${getSourceLabel(paper.source)}</span>
                  <span class="badge cat-badge ${normalizeCategory(paper.category)}">${getCategoryLabel(paper.category)}</span>
                </div>
                <div class="text-sm font-medium text-gray-800 line-clamp-2">${paper.title}</div>
                ${paper.structured_summary?.chinese_title ? `<div class="text-xs text-primary mt-0.5">${paper.structured_summary.chinese_title}</div>` : ''}
                ${paper.structured_summary?.chinese_summary ? `<div class="text-xs text-gray-500 mt-1 line-clamp-2">${paper.structured_summary.chinese_summary}</div>` : ''}
              </div>
            </div>`;
          item.addEventListener('click', () => {
            window.location.href = `paper-detail.html?id=${encodeURIComponent(paper.paper_id)}`;
          });
          resultsEl.appendChild(item);
        });
      }

      // 按 今日推荐 → 历史论文 → 经典论文 顺序渲染
      renderGroup(todayResults,    '今日推荐', 'fa-fire',    5);
      renderGroup(historyResults,  '历史论文', 'fa-calendar', 5);
      renderGroup(classicsResults, '经典论文', 'fa-star',    5);

      // 底部"查看全部"链接
      if (total > 0) {
        const more = document.createElement('div');
        more.className = 'text-center pt-3 pb-1 border-t border-gray-100 mt-2';
        more.innerHTML = `<a href="history.html?q=${encodeURIComponent(q)}" class="text-sm text-accent hover:underline">在历史页查看全部 ${total} 条结果 →</a>`;
        resultsEl.appendChild(more);
      }
    } catch (err) {
      resultsEl.innerHTML = '<div class="text-center text-red-400 text-sm py-4">搜索失败，请重试</div>';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
