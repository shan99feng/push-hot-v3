/**
 * 工具函数库
 */

// ===== 日期格式化 =====
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  // 非当年时加上年份，避免误解
  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateFull(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ===== 分类映射 =====
const CATEGORY_MAP = {
  llm: { label: '大模型', color: 'llm' },
  multimodal: { label: '多模态', color: 'multimodal' },
  cv: { label: '计算机视觉', color: 'cv' },
  recsys: { label: '搜广推', color: 'recsys' },
  rl: { label: '强化学习', color: 'rl' },
  other: { label: '其他', color: 'other' },
};

function getCategoryLabel(cat) {
  // agent/nlp 合并到大模型
  const normalizedCat = (cat === 'agent' || cat === 'nlp') ? 'llm' : cat;
  return CATEGORY_MAP[normalizedCat]?.label || normalizedCat || '其他';
}

function normalizeCategory(cat) {
  return (cat === 'agent' || cat === 'nlp') ? 'llm' : (cat || 'other');
}

// ===== 来源映射 =====
const SOURCE_MAP = {
  arxiv: { label: 'arXiv', cls: 'arxiv' },
  huggingface: { label: '🤗 HF', cls: 'huggingface' },
  github: { label: 'GitHub', cls: 'github' },
  manual: { label: '精选', cls: 'manual' },
};

function getSourceLabel(source) {
  return SOURCE_MAP[source]?.label || source || '';
}

function getSourceClass(source) {
  return SOURCE_MAP[source]?.cls || '';
}

// ===== 用户 ID（localStorage 持久化） =====
function getUserId() {
  let uid = localStorage.getItem('apd_user_id');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('apd_user_id', uid);
  }
  return uid;
}

// ===== 收藏状态管理 =====
function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem('apd_favorites') || '[]');
  } catch { return []; }
}

function isFavorited(paperId) {
  return getFavorites().includes(paperId);
}

function toggleLocalFavorite(paperId) {
  const favs = getFavorites();
  const idx = favs.indexOf(paperId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(paperId);
  }
  localStorage.setItem('apd_favorites', JSON.stringify(favs));
  return idx < 0; // true = 已收藏
}

// ===== 防抖 =====
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ===== 截断文本 =====
function truncate(str, maxLen = 100) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

// ===== 回到顶部按钮 =====
function initScrollToTop() {
  const btn = document.getElementById('btnTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
      btn.classList.remove('hidden');
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
      setTimeout(() => btn.classList.add('hidden'), 300);
    }
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ===== 移动端菜单 =====
function initMobileMenu() {
  const btn = document.getElementById('mobileMenuBtn');
  const menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', () => {
    menu.classList.toggle('hidden');
  });
}

// ===== Toast 提示 =====
function showToast(message, type = 'success', duration = 2500) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-yellow-600',
  };
  toast.className = `fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-white text-sm font-medium shadow-lg transition-all ${colors[type] || colors.info}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== 复制到剪贴板 =====
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  }
}

// ===== 渲染论文卡片（通用） =====
function renderPaperCard(paper, container) {
  const tpl = document.getElementById('paperTpl');
  if (!tpl) return null;

  const card = tpl.content.cloneNode(true);
  const article = card.querySelector('article');

  // 来源徽章
  const sourceBadge = card.querySelector('.source-badge');
  if (sourceBadge) {
    sourceBadge.textContent = getSourceLabel(paper.source);
    sourceBadge.classList.add(getSourceClass(paper.source));
  }

  // 分类徽章
  const catBadge = card.querySelector('.cat-badge');
  if (catBadge) {
    const normalizedCat = normalizeCategory(paper.category);
    catBadge.textContent = getCategoryLabel(paper.category);
    catBadge.classList.add(normalizedCat);
  }

  // 日期
  const dateEl = card.querySelector('.paper-date');
  if (dateEl) dateEl.textContent = formatDate(paper.published_date);

  // 点赞数
  if (paper.upvotes > 0) {
    const upvotesTag = card.querySelector('.upvotes-tag');
    if (upvotesTag) {
      upvotesTag.classList.remove('hidden');
      upvotesTag.classList.add('flex');
      const numEl = upvotesTag.querySelector('.upvotes-num');
      if (numEl) numEl.textContent = paper.upvotes;
    }
  }

  // 英文标题
  const titleEn = card.querySelector('.paper-title-en');
  if (titleEn) {
    titleEn.textContent = paper.title || '';
    titleEn.addEventListener('click', () => {
      window.location.href = `paper-detail.html?id=${encodeURIComponent(paper.paper_id)}`;
    });
  }

  // 中文标题
  const titleZh = card.querySelector('.paper-title-zh');
  const chTitle = paper.structured_summary?.chinese_title;
  if (titleZh && chTitle) {
    titleZh.textContent = chTitle;
    titleZh.classList.remove('hidden');
  }

  // 作者
  const authorsEl = card.querySelector('.paper-authors');
  if (authorsEl && paper.authors?.length) {
    const authStr = paper.authors.slice(0, 4).join(', ') + (paper.authors.length > 4 ? ' 等' : '');
    authorsEl.textContent = authStr;
  }

  // 一句话摘要
  const summaryShort = card.querySelector('.paper-summary-short');
  const chSummary = paper.structured_summary?.chinese_summary || paper.summary_zh;
  if (summaryShort && chSummary) {
    summaryShort.textContent = chSummary;
    summaryShort.classList.remove('hidden');
  }

  // 详细分析区
  const analysis = card.querySelector('.paper-analysis');
  const abstractContent = card.querySelector('.abstract-content');
  if (abstractContent) {
    abstractContent.textContent = paper.abstract || '暂无摘要';
  }

  // 核心亮点
  const highlightsBlock = card.querySelector('.highlights-block');
  const highlightsList = card.querySelector('.highlights-list');
  const contributions = paper.structured_summary?.key_contributions || [];
  if (highlightsBlock && highlightsList && contributions.length > 0) {
    highlightsBlock.classList.remove('hidden');
    contributions.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      highlightsList.appendChild(li);
    });
  }

  // 技术方法
  const techarchBlock = card.querySelector('.techarch-block');
  const techarchContent = card.querySelector('.techarch-content');
  const techArch = paper.structured_summary?.technical_architecture;
  if (techarchBlock && techarchContent && techArch) {
    techarchContent.textContent = techArch;
    techarchBlock.classList.remove('hidden');
  }

  // 局限性
  const limitationsBlock = card.querySelector('.limitations-block');
  const limitationsContent = card.querySelector('.limitations-content');
  const limitations = paper.structured_summary?.limitations;
  if (limitationsBlock && limitationsContent && limitations) {
    limitationsContent.textContent = limitations;
    limitationsBlock.classList.remove('hidden');
  }

  // 展开/折叠按钮
  const btnExpand = card.querySelector('.btn-expand');
  const expandIcon = card.querySelector('.expand-icon');
  if (btnExpand && analysis) {
    btnExpand.addEventListener('click', () => {
      const isHidden = analysis.classList.contains('hidden');
      analysis.classList.toggle('hidden');
      if (expandIcon) {
        expandIcon.style.transform = isHidden ? 'rotate(180deg)' : '';
      }
      btnExpand.childNodes[0].textContent = isHidden ? '收起分析 ' : '展开分析 ';
    });
  }

  // 详情页链接
  const detailLink = card.querySelector('.btn-detail');
  if (detailLink) {
    detailLink.href = `paper-detail.html?id=${encodeURIComponent(paper.paper_id)}`;
  }

  // 阅读原文链接
  const paperLink = card.querySelector('.btn-paper-link');
  if (paperLink) {
    paperLink.href = paper.url || '#';
  }

  // 标签
  const tagsEl = card.querySelector('.paper-tags');
  if (tagsEl) {
    const tags = paper.tags || paper.arxiv_categories || [];
    tags.slice(0, 3).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'paper-tag';
      // agent/nlp 标签统一显示为"大模型"
      span.textContent = (tag === 'agent' || tag === 'nlp') ? '大模型' : tag;
      tagsEl.appendChild(span);
    });
  }

  // 收藏按钮（纯本地，无需后端）
  const favBtn = card.querySelector('.favorite-btn');
  if (favBtn) {
    const paperId = paper.paper_id;
    const updateFavBtn = (favorited) => {
      const icon = favBtn.querySelector('i');
      if (icon) {
        icon.className = favorited ? 'fa fa-bookmark text-sm' : 'fa fa-bookmark-o text-sm';
      }
      favBtn.classList.toggle('text-rose-500', favorited);
      favBtn.classList.toggle('text-gray-400', !favorited);
    };
    updateFavBtn(isFavorited(paperId));
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const favorited = toggleLocalFavorite(paperId);
      updateFavBtn(favorited);
      showToast(favorited ? '✅ 已收藏' : '已取消收藏');
    });
  }

  if (container) container.appendChild(card);
  return article;
}

// ===== 初始化通用功能 =====
document.addEventListener('DOMContentLoaded', () => {
  initScrollToTop();
  initMobileMenu();
});
