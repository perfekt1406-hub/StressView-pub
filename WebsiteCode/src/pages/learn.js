// ===========================================
// Learn Page - Educational Articles
// ===========================================

import { articles } from '../content/articles.js';

let container = null;
let expandedId = null;

export function render() {
  return `
    <div class="page h-full bg-surface-dim pb-16">
      <!-- Header -->
      <div class="bg-surface p-4 border-b border-border shrink-0">
        <h1 class="text-xl font-bold text-text">Learn</h1>
        <p class="text-sm text-text-muted">Understanding stress and wellness</p>
      </div>
      
      <!-- Articles List - scrollable -->
      <div class="flex-1 overflow-y-auto p-4 space-y-3" id="articles-list">
        ${articles.map(article => renderArticleCard(article)).join('')}
      </div>
    </div>
  `;
}

function renderArticleCard(article) {
  const isExpanded = expandedId === article.id;
  
  return `
    <article 
      class="bg-surface rounded-xl shadow-sm overflow-hidden transition-all duration-300" 
      data-article-id="${article.id}"
    >
      <!-- Card Header (always visible) -->
      <button 
        class="article-header w-full p-4 text-left flex items-start gap-4 hover:bg-surface-dim/50 transition-colors"
        data-toggle="${article.id}"
      >
        <span class="text-3xl">${article.icon}</span>
        <div class="flex-1 min-w-0">
          <h2 class="font-semibold text-text text-lg">${article.title}</h2>
          <p class="text-sm text-text-muted mt-1">${article.summary}</p>
        </div>
        <span class="expand-icon text-text-muted transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </button>
      
      <!-- Expandable Content -->
      <div 
        class="article-content overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[2000px]' : 'max-h-0'}"
        data-content="${article.id}"
      >
        <div class="px-4 pb-4 pt-2 border-t border-border">
          <div class="prose prose-sm text-text">
            ${article.content}
          </div>
        </div>
      </div>
    </article>
  `;
}

export function mount(pageContainer) {
  container = pageContainer;
  
  // Add click handlers for article toggles
  container.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', handleToggle);
  });
}

export function unmount() {
  container = null;
  expandedId = null;
}

function handleToggle(e) {
  const btn = e.currentTarget;
  const articleId = parseInt(btn.dataset.toggle);
  
  // Toggle expanded state
  if (expandedId === articleId) {
    expandedId = null;
  } else {
    // Collapse previous if any
    if (expandedId !== null) {
      collapseArticle(expandedId);
    }
    expandedId = articleId;
  }
  
  // Update UI
  toggleArticle(articleId, expandedId === articleId);
}

function toggleArticle(id, expand) {
  const article = container.querySelector(`[data-article-id="${id}"]`);
  if (!article) return;
  
  const content = article.querySelector(`[data-content="${id}"]`);
  const icon = article.querySelector('.expand-icon');
  
  if (expand) {
    content.classList.remove('max-h-0');
    content.classList.add('max-h-[2000px]');
    icon.classList.add('rotate-180');
    
    // Scroll into view after a short delay
    setTimeout(() => {
      article.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  } else {
    content.classList.add('max-h-0');
    content.classList.remove('max-h-[2000px]');
    icon.classList.remove('rotate-180');
  }
}

function collapseArticle(id) {
  toggleArticle(id, false);
}
