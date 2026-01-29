// ===========================================
// Breathing Circle Component
// Animated circle for guided breathing exercises
// ===========================================

/**
 * Create a breathing circle element
 * @param {Object} options - Configuration options
 * @returns {HTMLElement} The breathing circle container
 */
export function createBreathingCircle(options = {}) {
  const {
    size = 200,
    minScale = 0.4,
    maxScale = 0.85,
  } = options;

  const container = document.createElement('div');
  container.className = 'breathing-circle-container';
  container.style.cssText = `
    position: relative;
    width: ${size}px;
    height: ${size}px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Outer glow ring
  const glowRing = document.createElement('div');
  glowRing.className = 'breathing-glow';
  glowRing.style.cssText = `
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: rgba(13, 148, 136, 0.15);
    transition: transform 0.3s ease-out, opacity 0.3s ease-out;
  `;

  // Main circle
  const circle = document.createElement('div');
  circle.className = 'breathing-circle';
  circle.style.cssText = `
    width: ${size * minScale}px;
    height: ${size * minScale}px;
    border-radius: 50%;
    background: #0d9488;
    box-shadow: 0 0 40px rgba(13, 148, 136, 0.4);
    transition: width 0.1s linear, height 0.1s linear;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Inner content (timer/phase text)
  const content = document.createElement('div');
  content.className = 'breathing-content';
  content.style.cssText = `
    text-align: center;
    color: white;
    font-weight: 600;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition: font-size 0.1s linear;
  `;

  circle.appendChild(content);
  container.appendChild(glowRing);
  container.appendChild(circle);

  // Store references for animation
  container._circle = circle;
  container._glow = glowRing;
  container._content = content;
  container._size = size;
  container._minScale = minScale;
  container._maxScale = maxScale;
  container._currentProgress = 0;

  return container;
}

/**
 * Animate the breathing circle to a specific scale
 * @param {HTMLElement} container - The breathing circle container
 * @param {number} progress - Progress from 0 to 1
 */
export function setCircleProgress(container, progress) {
  const { _circle, _glow, _content, _size, _minScale, _maxScale } = container;
  
  const scale = _minScale + (progress * (_maxScale - _minScale));
  const newSize = _size * scale;
  
  _circle.style.width = `${newSize}px`;
  _circle.style.height = `${newSize}px`;
  
  // Scale font size proportionally with circle size
  // Base font sizes: 2.5rem for main text, 0.875rem for subtext at max scale
  const fontScale = scale / _maxScale;
  const mainFontSize = 1.5 + (fontScale * 1.5); // 1.5rem to 3rem
  const subFontSize = 0.75 + (fontScale * 0.25); // 0.75rem to 1rem
  
  _content.style.setProperty('--main-font-size', `${mainFontSize}rem`);
  _content.style.setProperty('--sub-font-size', `${subFontSize}rem`);
  
  // Glow intensity follows progress
  _glow.style.opacity = 0.3 + (progress * 0.7);
  _glow.style.transform = `scale(${0.8 + progress * 0.4})`;
  
  // Store current progress
  container._currentProgress = progress;
}

/**
 * Set the content text inside the circle
 * @param {HTMLElement} container - The breathing circle container
 * @param {string} text - Text to display
 * @param {string} subtext - Optional subtext
 */
export function setCircleContent(container, text, subtext = '', options = {}) {
  const { fontScale = 1 } = options;
  const { _content, _currentProgress = 0, _minScale, _maxScale } = container;
  
  // Calculate current font scale based on progress
  const scale = _minScale + (_currentProgress * (_maxScale - _minScale));
  const fontScaleFactor = scale / _maxScale;
  const mainFontSize = (1.5 + (fontScaleFactor * 1.5)) * fontScale; // 1.5rem to 3rem
  const subFontSize = (0.75 + (fontScaleFactor * 0.25)) * fontScale; // 0.75rem to 1rem
  
  _content.innerHTML = `
    <div style="font-size: ${mainFontSize}rem; line-height: 1.1;">${text}</div>
    ${subtext ? `<div style="font-size: ${subFontSize}rem; opacity: 0.9; margin-top: 4px;">${subtext}</div>` : ''}
  `;
}

/**
 * Set circle color based on phase
 * @param {HTMLElement} container - The breathing circle container
 * @param {string} phase - 'inhale', 'hold', 'exhale', or 'idle'
 */
export function setCirclePhase(container, phase) {
  const { _circle } = container;
  
  const colors = {
    inhale: '#0d9488',  // Teal
    hold: '#0891b2',    // Cyan
    exhale: '#059669',  // Emerald
    idle: '#6b7280',    // Gray
  };
  
  _circle.style.background = colors[phase] || colors.idle;
}

/**
 * Reset circle to idle state
 * @param {HTMLElement} container - The breathing circle container
 */
export function resetCircle(container) {
  setCircleProgress(container, 0);
  setCirclePhase(container, 'idle');
  setCircleContent(container, 'Ready', '', { fontScale: 0.75 });
}
