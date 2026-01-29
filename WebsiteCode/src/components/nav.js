// ===========================================
// Bottom Navigation Component
// ===========================================

const navItems = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/breathe', label: 'Breathe', icon: 'wind' },
  { path: '/today', label: 'Today', icon: 'calendar' },
  { path: '/trends', label: 'Trends', icon: 'trending-up' },
  { path: '/learn', label: 'Learn', icon: 'book-open' },
];

// Simple SVG icons
const icons = {
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  wind: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`,
  calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
  'trending-up': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  'book-open': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
};

export function renderNav(container) {
  const nav = document.createElement('nav');
  nav.className = 'fixed bottom-0 left-0 right-0 bg-surface border-t border-border nav-bottom z-50';
  
  const inner = document.createElement('div');
  inner.className = 'flex justify-around items-center py-2 w-full';
  
  navItems.forEach(item => {
    const button = document.createElement('a');
    button.href = `#${item.path}`;
    button.className = 'flex flex-col items-center gap-1 px-3 py-1 text-text-muted transition-colors';
    button.dataset.navItem = item.path;
    
    button.innerHTML = `
      <span class="w-6 h-6">${icons[item.icon]}</span>
      <span class="text-xs font-medium">${item.label}</span>
    `;
    
    inner.appendChild(button);
  });
  
  nav.appendChild(inner);
  container.appendChild(nav);
}
