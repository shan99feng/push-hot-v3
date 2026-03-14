/**
 * 历史论文页逻辑
 * 纯静态方案：直接读取 JSON 文件，无需后端
 */

(function () {
  const $ = id => document.getElementById(id);

  // ===== 状态 =====
  // 获取北京时间（UTC+8）的今日日期字符串 YYYY-MM-DD
  function getBeijingToday() {
    const now = new Date();
    const bjOffset = 8 * 60; // 北京时间 UTC+8，单位分钟
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bjDate = new Date(utcMs + bjOffset * 60000);
    return {
      year: bjDate.getFullYear(),
      month: bjDate.getMonth(),
      dateStr: `${bjDate.getFullYear()}-${String(bjDate.getMonth() + 1).padStart(2, '0')}-${String(bjDate.getDate()).padStart(2, '0')}`,
    };
  }

  const bjToday = getBeijingToday();

  let state = {
    mode: 'date',          // 'date' | 'search' | 'allHistory'
    selectedDate: null,
    searchQuery: '',
    allPapers: [],         // 当前加载的全部论文
    filteredPapers: [],    // 筛选后的论文
    allHistoryPapers: [],  // 所有历史论文缓存
    displayCount: 15,
    category: 'all',
    sort: 'hot_score',
    datesWithData: new Set(),
    calYear: bjToday.year,
    calMonth: bjToday.month,
  };

  const PAGE_SIZE = 15;

  // ===== 初始化 =====
  async function init() {
    // 解析 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const initDate = urlParams.get('date');
    const initQuery = urlParams.get('q');

    // 加载日期索引
    await loadDates();

    // 根据 URL 参数决定初始模式
    if (initQuery) {
      enterSearchMode(initQuery);
    } else if (initDate) {
      selectDate(initDate);
    }

    setupEventListeners();
  }

  // ===== 加载日期索引 =====
  async function loadDates() {
    try {
      const index = await API.getDates();
      const dates = index.dates || [];
      dates.forEach(d => state.datesWithData.add(d.date));
      renderDateList(dates);
      renderCalendar();
      // 异步加载全部汇总统计
      loadTotalStats(dates);
    } catch (err) {
      console.error('加载日期索引失败:', err);
      const dateList = $('dateList');
      if (dateList) dateList.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">加载失败</div>';
    }
  }

  // ===== 加载全部汇总统计 =====
  async function loadTotalStats(dates) {
    const totalStatsEl = $('totalStatsList');
    if (!totalStatsEl) return;
    if (dates.length === 0) {
      totalStatsEl.innerHTML = '<div class="text-center py-2 text-gray-400 text-xs">暂无数据</div>';
      return;
    }
    // 并行加载所有日期数据并缓存
    try {
      const allData = await Promise.all(dates.map(d => API.getDailyPapers(d.date).catch(() => ({ papers: [] }))));
      const counts = { llm: 0, multimodal: 0, cv: 0, recsys: 0, rl: 0 };
      let total = 0;
      allData.forEach(data => {
        (data.papers || []).forEach(p => {
          total++;
          const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : p.category;
          if (counts[cat] !== undefined) counts[cat]++;
          state.allHistoryPapers.push(p);
        });
      });
      renderStatsBlock(totalStatsEl, counts, total, true);
    } catch (err) {
      totalStatsEl.innerHTML = '<div class="text-center py-2 text-gray-400 text-xs">加载失败</div>';
    }
  }

  // ===== 渲染统计块（复用） =====
  const CAT_CONFIG = [
    { key: 'llm',       label: '大模型',   icon: 'fa-user',     color: 'text-blue-600' },
    { key: 'multimodal',label: '多模态',   icon: 'fa-image',    color: 'text-purple-600' },
    { key: 'cv',        label: '计算机视觉',icon: 'fa-eye',     color: 'text-green-600' },
    { key: 'recsys',    label: '搜广推',   icon: 'fa-search',   color: 'text-orange-600' },
    { key: 'rl',        label: '强化学习', icon: 'fa-gamepad',  color: 'text-rose-600' },
  ];

  // clickable=true 时，类别行可点击
  // onCatClick: 可选回调函数(cat) => void，不传则默认调用 enterAllHistoryMode
  function renderStatsBlock(container, counts, total, clickable = false, onCatClick = null) {
    let html = `<div class="flex justify-between text-sm mb-1">`;
    if (clickable) {
      html += `<button class="text-gray-500 hover:text-accent transition-colors" data-cat="all">论文总数</button>
        <button class="font-semibold text-primary hover:text-accent transition-colors" data-cat="all">${total}</button>`;
    } else {
      html += `<span class="text-gray-500">论文总数</span><span class="font-semibold text-primary">${total}</span>`;
    }
    html += `</div>`;

    CAT_CONFIG.forEach(({ key, label, icon, color }) => {
      const n = counts[key] || 0;
      const pct = total > 0 ? Math.round(n / total * 100) : 0;
      if (clickable) {
        html += `<div class="flex justify-between items-center text-sm group cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 transition-colors" data-cat="${key}">
          <span class="text-gray-500 group-hover:text-accent"><i class="fa ${icon} mr-1 text-xs"></i>${label}</span>
          <span class="${color} font-semibold">${n}<span class="text-gray-300 font-normal text-xs ml-1">${pct}%</span></span>
        </div>`;
      } else {
        html += `<div class="flex justify-between items-center text-sm">
          <span class="text-gray-500"><i class="fa ${icon} mr-1 text-xs"></i>${label}</span>
          <span class="${color} font-semibold">${n}<span class="text-gray-300 font-normal text-xs ml-1">${pct}%</span></span>
        </div>`;
      }
    });
    container.innerHTML = html;

    // 绑定点击事件
    if (clickable) {
      container.querySelectorAll('[data-cat]').forEach(el => {
        el.addEventListener('click', () => {
          const cat = el.dataset.cat;
          if (onCatClick) {
            onCatClick(cat);  // 使用自定义回调（如当日统计筛选）
          } else {
            enterAllHistoryMode(cat);  // 默认：全部汇总模式
          }
        });
      });
    }
  }

  // ===== 进入全部历史 + 类别筛选模式 =====
  function enterAllHistoryMode(category) {
    if (state.allHistoryPapers.length === 0) return;
    state.mode = 'allHistory';
    state.category = category;
    state.selectedDate = null;
    state.displayCount = PAGE_SIZE;
    state.allPapers = state.allHistoryPapers;

    // 更新 URL
    const url = new URL(window.location);
    url.searchParams.delete('date');
    url.searchParams.delete('q');
    window.history.pushState({}, '', url);

    // 隐藏搜索 Banner，显示筛选栏
    $('searchBanner').classList.add('hidden');
    $('filterBar').classList.remove('hidden');
    $('emptyDateState').classList.add('hidden');
    $('emptyState').classList.add('hidden');
    $('paperList').innerHTML = '';

    // 更新标题
    const catLabel = category === 'all' ? '全部类别' : getCategoryLabel(category);
    $('pageTitle').textContent = `历史论文 · ${catLabel}`;
    $('pageSubtitle').textContent = `所有历史日期 · 共 ${state.allHistoryPapers.length} 篇`;

    // 同步分类筛选 UI
    $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === category);
    });

    // 取消日期列表高亮
    document.querySelectorAll('.date-nav-item').forEach(el => el.classList.remove('active'));

    applyFilterAndRender();
  }

  // ===== 渲染日期列表 =====
  function renderDateList(dates) {
    const dateList = $('dateList');
    if (!dateList) return;
    if (dates.length === 0) {
      dateList.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">暂无历史数据</div>';
      return;
    }
    dateList.innerHTML = '';
    dates.slice(0, 30).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'date-nav-item w-full text-left';
      btn.dataset.date = item.date;
      btn.innerHTML = `<span>${item.date}</span><span class="date-count">${item.total}</span>`;
      btn.addEventListener('click', () => selectDate(item.date));
      dateList.appendChild(btn);
    });
  }

  // ===== 渲染日历 =====
  function renderCalendar() {
    const calGrid = $('calGrid');
    const calMonthLabel = $('calMonthLabel');
    if (!calGrid) return;

    const { calYear: year, calMonth: month } = state;
    if (calMonthLabel) calMonthLabel.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = getBeijingToday().dateStr;

    calGrid.innerHTML = '';

    // 空白格
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day cal-empty';
      calGrid.appendChild(empty);
    }

    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasData = state.datesWithData.has(dateStr);
      const isToday = dateStr === today;
      const isSelected = dateStr === state.selectedDate;

      const dayEl = document.createElement('div');
      dayEl.className = 'cal-day';
      dayEl.textContent = d;

      if (hasData) dayEl.classList.add('cal-has-data');
      else dayEl.classList.add('cal-no-data');
      if (isToday) dayEl.classList.add('cal-today');
      if (isSelected) dayEl.classList.add('cal-selected');

      if (hasData) {
        dayEl.addEventListener('click', () => selectDate(dateStr));
        dayEl.title = `${dateStr}`;
      }
      calGrid.appendChild(dayEl);
    }
  }

  // ===== 选择日期 =====
  function selectDate(date) {
    state.mode = 'date';
    state.selectedDate = date;
    state.category = 'all';
    state.sort = 'hot_score';
    state.displayCount = PAGE_SIZE;

    // 同步日历月份（直接解析 YYYY-MM-DD，避免 UTC 偏移）
    const dp = date && date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dp) {
      state.calYear = parseInt(dp[1]);
      state.calMonth = parseInt(dp[2]) - 1;
    }
    renderCalendar();

    // 更新日期列表高亮
    document.querySelectorAll('.date-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.date === date);
    });

    // 更新 URL
    const url = new URL(window.location);
    url.searchParams.set('date', date);
    url.searchParams.delete('q');
    window.history.pushState({}, '', url);

    // 隐藏搜索 Banner，显示筛选栏
    $('searchBanner').classList.add('hidden');
    $('filterBar').classList.remove('hidden');

    // 重置分类筛选 UI
    $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === 'all');
    });

    loadDatePapers(date);
  }

  // ===== 加载指定日期论文 =====
  async function loadDatePapers(date) {
    showLoading(true);
    $('emptyDateState').classList.add('hidden');
    $('emptyState').classList.add('hidden');
    $('paperList').innerHTML = '';

    try {
      const data = await API.getDailyPapers(date);
      state.allPapers = data.papers || [];

      // 更新标题
      $('pageTitle').textContent = `${date} 论文推送`;
      $('pageSubtitle').textContent = `共 ${data.total} 篇论文`;

      // 更新当日类别统计
      updateDailyStats(date, state.allPapers);

      applyFilterAndRender();
    } catch (err) {
      console.error('加载历史论文失败:', err);
      showLoading(false);
      $('emptyState').classList.remove('hidden');
      $('pageSubtitle').textContent = '该日期暂无数据';
    }
  }

  // ===== 更新当日类别统计 =====
  function updateDailyStats(date, papers) {
    const card = $('dailyStatsCard');
    const dateLabel = $('dailyStatsDate');
    const listEl = $('dailyStatsList');
    if (!card || !listEl) return;

    const counts = { llm: 0, multimodal: 0, cv: 0, recsys: 0, rl: 0 };
    papers.forEach(p => {
      const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : p.category;
      if (counts[cat] !== undefined) counts[cat]++;
    });

    if (dateLabel) dateLabel.textContent = date;
    // clickable=true：点击分类直接筛选当日论文
    renderStatsBlock(listEl, counts, papers.length, true, (cat) => {
      // 同步顶部筛选栏 active 状态
      $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === cat);
      });
      state.category = cat;
      applyFilterAndRender();
      // 滚动到论文列表
      $('paperList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    card.classList.remove('hidden');
  }

  // ===== 进入搜索模式 =====
  async function enterSearchMode(q) {
    state.mode = 'search';
    state.searchQuery = q;
    state.displayCount = PAGE_SIZE;

    // 更新 URL
    const url = new URL(window.location);
    url.searchParams.set('q', q);
    url.searchParams.delete('date');
    window.history.pushState({}, '', url);

    // 显示搜索 Banner，隐藏筛选栏
    $('searchBanner').classList.remove('hidden');
    $('filterBar').classList.add('hidden');
    $('searchKeyword').textContent = q;
    $('emptyDateState').classList.add('hidden');
    $('emptyState').classList.add('hidden');
    $('paperList').innerHTML = '';

    $('pageTitle').textContent = '搜索结果';
    $('pageSubtitle').textContent = `正在搜索"${q}"...`;

    showLoading(true);
    try {
      const data = await API.searchPapers(q, 30);
      state.allPapers = data.papers || [];
      $('pageSubtitle').textContent = `共找到 ${data.total} 篇相关论文`;
      renderPapers();
    } catch (err) {
      console.error('搜索失败:', err);
      $('pageSubtitle').textContent = '搜索失败，请重试';
    } finally {
      showLoading(false);
    }
  }

  // ===== 筛选 + 排序 + 渲染 =====
  function applyFilterAndRender() {
    if (state.mode === 'search') {
      state.filteredPapers = [...state.allPapers];
    } else {
      // 'date' 和 'allHistory' 模式都支持类别筛选
      state.filteredPapers = state.category === 'all'
        ? [...state.allPapers]
        : state.allPapers.filter(p => {
            const cat = (p.category === 'agent' || p.category === 'nlp') ? 'llm' : (p.category || 'other');
            return cat === state.category;
          });
    }

    const sortFns = {
      hot_score: (a, b) => (b.hot_score || 0) - (a.hot_score || 0),
      upvotes:   (a, b) => (b.upvotes || 0) - (a.upvotes || 0),
      date:      (a, b) => new Date(b.published_date) - new Date(a.published_date),
    };
    state.filteredPapers.sort(sortFns[state.sort] || sortFns.hot_score);

    state.displayCount = PAGE_SIZE;
    renderPapers();
  }

  // ===== 渲染论文列表 =====
  function renderPapers() {
    showLoading(false);
    const paperList = $('paperList');
    paperList.innerHTML = '';

    const toShow = state.filteredPapers.slice(0, state.displayCount);

    if (toShow.length === 0) {
      $('emptyState').classList.remove('hidden');
      $('loadMoreWrap').classList.add('hidden');
      // 更新统计
      $('statsBar').textContent = '';
      return;
    }

    $('emptyState').classList.add('hidden');
    toShow.forEach(paper => renderPaperCard(paper, paperList));

    // 统计信息
    const catLabel = state.category === 'all' ? '全部分类' : getCategoryLabel(state.category);
    $('statsBar').textContent = state.mode === 'search'
      ? `共 ${state.filteredPapers.length} 篇结果`
      : `${catLabel} · 共 ${state.filteredPapers.length} 篇`;

    // 加载更多
    const hasMore = state.displayCount < state.filteredPapers.length;
    $('loadMoreWrap').classList.toggle('hidden', !hasMore);
  }

  function showLoading(show) {
    $('loadingState').classList.toggle('hidden', !show);
  }

  // ===== 事件监听 =====
  function setupEventListeners() {
    // 日历翻月
    $('calPrevMonth').addEventListener('click', () => {
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    });
    $('calNextMonth').addEventListener('click', () => {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    });

    // 移动端日期选择器
    const mobileDatePicker = $('mobileDatePicker');
    if (mobileDatePicker) {
      mobileDatePicker.addEventListener('change', e => {
        if (e.target.value) selectDate(e.target.value);
      });
    }

    // 分类筛选
    $('categoryFilter').addEventListener('click', e => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      $('categoryFilter').querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.category = tab.dataset.category;
      applyFilterAndRender();
    });

    // 排序
    $('sortSelect').addEventListener('change', e => {
      state.sort = e.target.value;
      applyFilterAndRender();
    });

    // 加载更多
    $('btnLoadMore').addEventListener('click', () => {
      state.displayCount += PAGE_SIZE;
      renderPapers();
    });

    // 清除搜索
    $('clearSearch').addEventListener('click', () => {
      $('searchBanner').classList.add('hidden');
      $('filterBar').classList.add('hidden');
      $('emptyDateState').classList.remove('hidden');
      $('paperList').innerHTML = '';
      $('pageTitle').textContent = '历史论文';
      $('pageSubtitle').textContent = '请选择日期或搜索关键词';
      $('statsBar').textContent = '';
      state.mode = 'date';
      state.allPapers = [];
      state.category = 'all';
      document.querySelectorAll('.date-nav-item').forEach(el => el.classList.remove('active'));
      const url = new URL(window.location);
      url.searchParams.delete('q');
      url.searchParams.delete('date');
      window.history.pushState({}, '', url);
    });

    // Header 搜索框
    const headerSearch = $('headerSearch');
    if (headerSearch) {
      headerSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const q = e.target.value.trim();
          if (q.length >= 2) enterSearchMode(q);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
