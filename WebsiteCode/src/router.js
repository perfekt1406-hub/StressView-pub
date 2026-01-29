// ===========================================
// Simple Hash Router for SPA
// 
// Uses hash-based routing (#/path) instead of History API for better
// Electron compatibility and simpler deployment. Pages are lazy-loaded
// on demand to reduce initial bundle size.
// ===========================================

import { renderNav } from './components/nav.js';

// Page route configuration - lazy-loaded to reduce initial bundle size
// Each route returns a dynamic import promise that resolves to the page module
// Pages must export: render() (returns HTML string), mount(container), unmount()
const pages = {
  '/': () => import('./pages/home.js'),
  '/breathe': () => import('./pages/breathe.js'),
  '/today': () => import('./pages/today.js'),
  '/trends': () => import('./pages/trends.js'),
  '/learn': () => import('./pages/learn.js'),
  '/settings': () => import('./pages/settings.js'),
};

// Router state
let currentPage = null; // Currently mounted page module
let appContainer = null; // Main app container element
let isTransitioning = false; // Prevents concurrent route transitions

// Animation timing constants
const TRANSITION_DURATION_MS = 150; // Page exit animation duration

/**
 * Initialize the router system.
 * Sets up hash change listener and renders bottom navigation.
 * Must be called once during app initialization.
 */
export function initRouter() {
  appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('App container element not found');
  }
  
  // Listen for hash changes (user clicks nav links or browser back/forward)
  // Hash routing works in all browsers and Electron without special configuration
  window.addEventListener('hashchange', handleRoute);
  
  // Render bottom navigation bar (persists across all page changes)
  renderNav(appContainer);
}

/**
 * Navigate to a new route programmatically.
 * Updates the URL hash, which triggers the hashchange event and route handler.
 * 
 * @param {string} path - Route path (e.g., '/today', '/settings')
 */
export async function navigate(path) {
  // Prevent navigation during active transition to avoid race conditions
  // and ensure smooth animations complete before starting new ones
  if (isTransitioning) return;
  
  // Update URL hash if it's different (triggers hashchange event)
  // If hash is already correct, call handleRoute directly (no event fired)
  if (window.location.hash !== `#${path}`) {
    window.location.hash = path;
    return; // hashchange event will call handleRoute automatically
  }
  
  // Hash already matches - handle route directly
  await handleRoute();
}

/**
 * Handle route changes - the core routing logic.
 * Manages page transitions, lazy loading, mounting/unmounting, and error handling.
 * 
 * Flow:
 * 1. Validate route exists
 * 2. Animate current page exit
 * 3. Unmount current page (cleanup event listeners)
 * 4. Lazy-load new page module
 * 5. Render new page HTML
 * 6. Mount new page (attach event listeners)
 * 7. Update navigation active state
 */
async function handleRoute() {
  // Prevent concurrent transitions - ensures animations complete before new ones start
  if (isTransitioning) return;
  
  // Extract path from hash (remove # prefix, default to home)
  const path = window.location.hash.slice(1) || '/';
  
  // Find matching page loader function
  const pageLoader = pages[path];
  if (!pageLoader) {
    console.warn(`Route not found: ${path}`);
    // Redirect to home page for unknown routes
    window.location.hash = '/';
    return;
  }
  
  isTransitioning = true;
  
  // Get or create page container element
  // Container persists across route changes to enable smooth transitions
  let pageContainer = document.getElementById('page-container');
  if (!pageContainer) {
    pageContainer = document.createElement('div');
    pageContainer.id = 'page-container';
    // Pages handle their own bottom padding to account for fixed navigation bar
    pageContainer.className = '';
    appContainer.insertBefore(pageContainer, appContainer.firstChild);
  }
  
  // Exit animation for current page (if one exists)
  // Adds 'page-exit' class which triggers CSS transition
  const currentContent = pageContainer.querySelector('.page');
  if (currentContent) {
    currentContent.classList.add('page-exit');
    await sleep(TRANSITION_DURATION_MS);
  }
  
  // Unmount current page to clean up event listeners and subscriptions
  // Prevents memory leaks and ensures clean state for next page
  if (currentPage?.unmount) {
    currentPage.unmount();
  }
  
  // Load and mount new page
  try {
    // Lazy-load the page module (reduces initial bundle size)
    const pageModule = await pageLoader();
    currentPage = pageModule;
    
    // Clear container and render new page HTML
    // Pages can return either HTML string or DOM element
    pageContainer.innerHTML = '';
    const content = pageModule.render();
    if (typeof content === 'string') {
      pageContainer.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      pageContainer.appendChild(content);
    }
    
    // Mount page - attach event listeners, initialize components, subscribe to state
    // This is where pages set up their interactive functionality
    if (pageModule.mount) {
      await pageModule.mount(pageContainer);
    }
    
    // Update navigation bar to highlight active route
    updateNavActive(path);
    
    // Scroll to top on route change (prevents showing previous page's scroll position)
    window.scrollTo(0, 0);
    
  } catch (error) {
    console.error('Error loading page:', error);
    // Show user-friendly error state instead of blank page
    // Allows user to refresh or navigate away
    pageContainer.innerHTML = `
      <div class="page empty-state min-h-screen">
        <div class="empty-state-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <p class="empty-state-title">Something went wrong</p>
        <p class="empty-state-description">We couldn't load this page. Please try again.</p>
        <button onclick="location.reload()" class="btn btn-primary mt-4">Refresh</button>
      </div>
    `;
  } finally {
    // Always reset transition flag, even on error
    isTransitioning = false;
  }
}

/**
 * Update navigation bar to highlight the active route.
 * Toggles visual styling on nav items based on current path.
 * 
 * @param {string} path - Current route path
 */
function updateNavActive(path) {
  document.querySelectorAll('[data-nav-item]').forEach(item => {
    const isActive = item.dataset.navItem === path;
    // Active route gets primary color, inactive routes are muted
    item.classList.toggle('text-primary', isActive);
    item.classList.toggle('text-text-muted', !isActive);
  });
}

/**
 * Get the current route path from the URL hash.
 * 
 * @returns {string} Current route path (defaults to '/' if no hash)
 */
export function getCurrentPath() {
  return window.location.hash.slice(1) || '/';
}

/**
 * Sleep/delay helper for async operations.
 * Used to wait for CSS transitions to complete.
 * 
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
