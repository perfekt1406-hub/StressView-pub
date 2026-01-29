// ===========================================
// Shared UI Components
// Toast notifications
// ===========================================

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} type - 'default', 'success', 'error', 'warning'
 * @param {number} duration - Duration in ms
 */
export function showToast(message, type = 'default', duration = 3000) {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const typeClass = type !== 'default' ? `toast-${type}` : '';
  
  const toast = document.createElement('div');
  toast.className = `toast ${typeClass}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}
