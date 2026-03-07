/**
 * 论文详情页逻辑
 * 纯静态方案：从 JSON 文件读取数据，无需后端
 */

(function () {
  const $ = id => document.getElementById(id);

  // 从 URL 获取论文 ID
  const urlParams = new URLSearchParams(window.location.search);
  const paperId = urlParams.get('id');

  async function init() {
    if (!paperId) {
      showError();
      return;
    }
    try {
      const paper = await API.getPaperById(paperId);
      renderDetail(paper);
    } catch (err) {
      console.error('加载论文详情失败:', err);
      showError();
    }
    setupEventListeners();
  }

  // ===== 渲染详情 =====
  function renderDetail(paper) {
    $('loadingState').classList.add('hidden');
    $('paperDetail').classList.remove('hidden');

    // 更新页面标题
    const ss = paper.structured_summary;
    const zhTitle = ss?.chinese_title || '';
    document.title = `${zhTitle || paper.title} · AI Papers Daily`;

    // 面包屑
    const $bc = $('breadcrumbCategory');
    if ($bc) $bc.textContent = getCategoryLabel(paper.category);
    const $bt = $('breadcrumbTitle');
    if ($bt) $bt.textContent = truncate(paper.title, 50);

    // 来源 & 分类徽章
    const sourceBadge = $('detailSourceBadge');
    if (sourceBadge) {
      sourceBadge.textContent = getSourceLabel(paper.source);
      sourceBadge.classList.add(getSourceClass(paper.source));
    }
    const catBadge = $('detailCatBadge');
    if (catBadge) {
      catBadge.textContent = getCategoryLabel(paper.category);
      catBadge.classList.add(paper.category || 'other');
    }

    // 日期
    const dateEl = $('detailDate');
    if (dateEl) dateEl.textContent = formatDateFull(paper.published_date);

    // 点赞数
    if (paper.upvotes > 0) {
      const el = $('detailUpvotes');
      if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
      const num = $('detailUpvotesNum');
      if (num) num.textContent = paper.upvotes;
    }

    // 英文标题
    const titleEn = $('detailTitleEn');
    if (titleEn) titleEn.textContent = paper.title || '';

    // 中文标题
    if (zhTitle) {
      const titleZh = $('detailTitleZh');
      if (titleZh) { titleZh.textContent = zhTitle; titleZh.classList.remove('hidden'); }
    }

    // 作者
    const authorsEl = $('detailAuthors');
    if (authorsEl && paper.authors?.length) {
      const str = paper.authors.slice(0, 6).join(', ') + (paper.authors.length > 6 ? ' 等' : '');
      authorsEl.innerHTML = `<i class="fa fa-users text-gray-400"></i> ${str}`;
    }

    // 链接按钮
    const linkPaper = $('linkPaper');
    if (linkPaper && paper.url) linkPaper.href = paper.url;

    const linkPDF = $('linkPDF');
    if (linkPDF && paper.pdf_url) {
      linkPDF.href = paper.pdf_url;
      linkPDF.classList.remove('hidden');
      linkPDF.classList.add('flex');
    }

    const linkCode = $('linkCode');
    if (linkCode && paper.code_url) {
      linkCode.href = paper.code_url;
      linkCode.classList.remove('hidden');
      linkCode.classList.add('flex');
    }

    const linkHF = $('linkHF');
    if (linkHF && paper.hf_url) {
      linkHF.href = paper.hf_url;
      linkHF.classList.remove('hidden');
      linkHF.classList.add('flex');
    }

    // 收藏按钮初始状态
    updateFavoriteUI(isFavorited(paper.paper_id));

    // ===== AI 生成内容 =====
    // 核心贡献 Banner
    if (ss?.chinese_summary) {
      const block = $('coreSummaryBlock');
      const text = $('coreSummaryText');
      if (block && text) { text.textContent = ss.chinese_summary; block.classList.remove('hidden'); }
    }

    // 摘要 Tab
    const abstractContent = $('abstractContent');
    if (abstractContent) abstractContent.textContent = paper.abstract || '暂无摘要';

    // 亮点分析 Tab
    if (ss) {
      renderAnalysisTab(ss);
      renderCritiqueTab(ss);
      renderApplicationTab(ss);
    }

    // 分享链接初始化
    initShareLinks(paper);
  }

  function renderAnalysisTab(ss) {
    const setBlock = (blockId, textId, content) => {
      if (!content) return;
      const block = $(blockId), text = $(textId);
      if (block && text) { text.textContent = content; block.classList.remove('hidden'); }
    };
    setBlock('painPointBlock', 'painPointText', ss.pain_point);
    setBlock('coreValueBlock', 'coreValueText', ss.core_value);
    setBlock('techArchBlock', 'techArchText', ss.technical_architecture);
    if (ss.quantitative_results && ss.quantitative_results !== '暂无量化数据') {
      setBlock('quantResultBlock', 'quantResultText', ss.quantitative_results);
    }
    if (ss.key_contributions?.length > 0) {
      const block = $('keyContribBlock');
      const list = $('keyContribList');
      if (block && list) {
        block.classList.remove('hidden');
        ss.key_contributions.forEach((item, idx) => {
          const div = document.createElement('div');
          div.className = 'contrib-item';
          div.innerHTML = `<span class="contrib-item-num">${idx + 1}</span><span>${item}</span>`;
          list.appendChild(div);
        });
      }
    }
  }

  function renderCritiqueTab(ss) {
    if (ss.competitors && ss.competitors !== '暂无对比信息') {
      const block = $('competitorsBlock'), text = $('competitorsText');
      if (block && text) { text.textContent = ss.competitors; block.classList.remove('hidden'); }
    }
    if (ss.technical_highlights?.length > 0) {
      const block = $('techHighlightsBlock'), list = $('techHighlightsList');
      if (block && list) {
        block.classList.remove('hidden');
        ss.technical_highlights.forEach(item => {
          const tag = document.createElement('span');
          tag.className = 'tech-highlight-tag';
          tag.textContent = item;
          list.appendChild(tag);
        });
      }
    }
    if (ss.limitations) {
      const block = $('limitationsBlock'), text = $('limitationsText');
      if (block && text) { text.textContent = ss.limitations; block.classList.remove('hidden'); }
    }
  }

  function renderApplicationTab(ss) {
    if (ss.application_scenarios?.length > 0) {
      const block = $('scenariosBlock'), list = $('scenariosList'), noData = $('noApplicationData');
      if (block && list) {
        block.classList.remove('hidden');
        if (noData) noData.classList.add('hidden');
        ss.application_scenarios.forEach(item => {
          const card = document.createElement('div');
          card.className = 'scenario-card';
          card.textContent = item;
          list.appendChild(card);
        });
      }
    }
  }

  // ===== 收藏 UI =====
  function updateFavoriteUI(favorited) {
    // 顶部按钮
    const icon1 = $('favoriteIcon'), text1 = $('favoriteText');
    if (icon1) icon1.className = favorited ? 'fa fa-bookmark' : 'fa fa-bookmark-o';
    if (text1) text1.textContent = favorited ? '已收藏' : '收藏';
    // 底部按钮
    const icon2 = $('favoriteIcon2'), text2 = $('favoriteText2');
    if (icon2) icon2.className = favorited ? 'fa fa-bookmark' : 'fa fa-bookmark-o';
    if (text2) text2.textContent = favorited ? '已收藏' : '收藏论文';
  }

  function handleFavorite() {
    const favorited = toggleLocalFavorite(paperId);
    updateFavoriteUI(favorited);
    showToast(favorited ? '✅ 已收藏' : '已取消收藏');
  }

  // ===== 分享 =====
  function initShareLinks(paper) {
    const title = paper.structured_summary?.chinese_title || paper.title || '';
    const url = window.location.href;

    const shareTwitter = $('shareTwitter');
    if (shareTwitter) {
      shareTwitter.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title + ' - AI Papers Daily')}&url=${encodeURIComponent(url)}`;
    }

    const shareCopyLink = $('shareCopyLink');
    if (shareCopyLink) {
      shareCopyLink.addEventListener('click', async () => {
        await copyToClipboard(url);
        showToast('✅ 链接已复制');
        $('shareModal').classList.add('hidden');
      });
    }

    const shareCopyTitle = $('shareCopyTitle');
    if (shareCopyTitle) {
      shareCopyTitle.addEventListener('click', async () => {
        await copyToClipboard(`${title}\n${url}`);
        showToast('✅ 标题+链接已复制');
        $('shareModal').classList.add('hidden');
      });
    }
  }

  // ===== Tab 切换 =====
  function setupTabSwitching() {
    const tabs = document.querySelectorAll('.detail-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active', 'text-accent', 'border-accent');
          t.classList.add('text-gray-500', 'border-transparent');
        });
        tab.classList.add('active', 'text-accent', 'border-accent');
        tab.classList.remove('text-gray-500', 'border-transparent');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        const target = $(`tab-${tab.dataset.tab}`);
        if (target) target.classList.remove('hidden');
      });
    });
  }

  // ===== 事件监听 =====
  function setupEventListeners() {
    setupTabSwitching();

    // 收藏按钮（顶部 + 底部）
    [$('btnFavorite'), $('btnFavorite2')].forEach(btn => {
      if (btn) btn.addEventListener('click', handleFavorite);
    });

    // 分享按钮（顶部 + 底部）
    const shareModal = $('shareModal');
    [$('btnShare'), $('btnShare2')].forEach(btn => {
      if (btn && shareModal) btn.addEventListener('click', () => shareModal.classList.remove('hidden'));
    });

    // 关闭分享弹窗
    const shareClose = $('shareClose');
    if (shareClose && shareModal) {
      shareClose.addEventListener('click', () => shareModal.classList.add('hidden'));
      shareModal.addEventListener('click', e => {
        if (e.target === shareModal) shareModal.classList.add('hidden');
      });
    }
  }

  function showError() {
    $('loadingState').classList.add('hidden');
    $('errorState').classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
