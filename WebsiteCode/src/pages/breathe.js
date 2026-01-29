// ===========================================
// Breathe Page - Guided Breathing Exercises
// ===========================================

import { state } from '../lib/state.js';
import { saveBreathingSession } from '../lib/storage.js';
import { 
  createBreathingCircle, 
  setCircleProgress, 
  setCircleContent, 
  setCirclePhase,
  resetCircle 
} from '../components/breathing-circle.js';

// Breathing techniques configuration
const TECHNIQUES = {
  calm: {
    name: 'Calm',
    description: '4-7-8 breathing for relaxation',
    phases: [
      { name: 'Inhale', duration: 4000 },
      { name: 'Hold', duration: 7000 },
      { name: 'Exhale', duration: 8000 },
    ],
    cycles: 4,
    color: 'teal',
  },
  focus: {
    name: 'Focus',
    description: 'Box breathing for concentration',
    phases: [
      { name: 'Inhale', duration: 4000 },
      { name: 'Hold', duration: 4000 },
      { name: 'Exhale', duration: 4000 },
      { name: 'Hold', duration: 4000 },
    ],
    cycles: 4,
    color: 'blue',
  },
  quick: {
    name: 'Quick Reset',
    description: 'Fast stress relief',
    phases: [
      { name: 'Deep Inhale', duration: 3000 },
      { name: 'Double Exhale', duration: 5000 },
    ],
    cycles: 3,
    color: 'green',
  },
};

// Session state
let currentTechnique = 'calm';
let isRunning = false;
let isPaused = false;
let currentCycle = 0;
let currentPhaseIndex = 0;
let phaseStartTime = 0;
let animationFrame = null;
let sessionStartTime = 0;
let startStress = 0;

// DOM references
let container = null;
let circleContainer = null;
let phaseText = null;
let timerText = null;
let cycleText = null;
let startBtn = null;
let pauseBtn = null;
let stopBtn = null;

export function render() {
  return `
    <div class="page h-full bg-surface-dim pb-16">
      <!-- Header -->
      <div class="p-4 text-center shrink-0">
        <h1 class="text-xl font-bold text-text">Breathing Exercise</h1>
        <p class="text-sm text-text-muted mt-1">Choose a technique and follow the circle</p>
      </div>
      
      <!-- Technique Selector -->
      <div class="px-4 shrink-0">
        <div class="flex gap-2 justify-center flex-wrap" id="technique-selector">
          ${Object.entries(TECHNIQUES).map(([key, tech]) => `
            <button 
              data-technique="${key}"
              class="technique-btn px-4 py-2 rounded-full text-sm font-medium transition-all ${
                key === currentTechnique 
                  ? 'bg-primary text-white shadow-md' 
                  : 'bg-surface text-text-muted border border-border hover:border-primary'
              }"
            >
              ${tech.name}
            </button>
          `).join('')}
        </div>
        <p class="text-center text-sm text-text-muted mt-3" id="technique-description">
          ${TECHNIQUES[currentTechnique].description}
        </p>
      </div>
      
      <!-- Breathing Circle Container - grows to fill space -->
      <div class="flex-1 flex items-center justify-center min-h-[200px] p-4" id="circle-container"></div>
      
      <!-- Phase & Timer Display -->
      <div class="text-center shrink-0">
        <p class="text-2xl md:text-3xl font-semibold text-text" id="phase-text">Ready</p>
        <p class="text-5xl md:text-6xl font-bold text-primary mt-2" id="timer-text">0:00</p>
        <p class="text-sm text-text-muted mt-2" id="cycle-text">
          ${TECHNIQUES[currentTechnique].cycles} cycles
        </p>
      </div>
      
      <!-- Controls -->
      <div class="flex justify-center gap-4 px-4 py-6 shrink-0" id="controls">
        <button id="start-btn" class="px-8 py-3 bg-primary text-white rounded-xl font-semibold shadow-lg hover:bg-primary-dark transition-colors">
          Start
        </button>
        <button id="pause-btn" class="hidden px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold shadow-lg hover:bg-amber-600 transition-colors">
          Pause
        </button>
        <button id="stop-btn" class="hidden px-6 py-3 bg-red-500 text-white rounded-xl font-semibold shadow-lg hover:bg-red-600 transition-colors">
          Stop
        </button>
      </div>
      
      <!-- Session Summary (hidden until complete) -->
      <div id="session-summary" class="hidden mx-4 p-6 bg-surface rounded-2xl shadow-lg shrink-0">
        <h2 class="text-lg font-bold text-text mb-4 text-center">Session Complete!</h2>
        <div class="grid grid-cols-3 gap-4 text-center">
          <div>
            <p class="text-2xl font-bold text-primary" id="summary-duration">0:00</p>
            <p class="text-xs text-text-muted">Duration</p>
          </div>
          <div>
            <p class="text-2xl font-bold text-primary" id="summary-cycles">0</p>
            <p class="text-xs text-text-muted">Cycles</p>
          </div>
          <div>
            <p class="text-2xl font-bold text-stress-calm" id="summary-stress">-0</p>
            <p class="text-xs text-text-muted">Stress Change</p>
          </div>
        </div>
        <button id="restart-btn" class="w-full mt-6 py-3 bg-primary text-white rounded-xl font-semibold">
          Start Another Session
        </button>
      </div>
    </div>
  `;
}

export function mount(pageContainer) {
  container = pageContainer;
  
  // Get DOM references
  phaseText = container.querySelector('#phase-text');
  timerText = container.querySelector('#timer-text');
  cycleText = container.querySelector('#cycle-text');
  startBtn = container.querySelector('#start-btn');
  pauseBtn = container.querySelector('#pause-btn');
  stopBtn = container.querySelector('#stop-btn');
  
  // Create and mount breathing circle
  const circleEl = container.querySelector('#circle-container');
  circleContainer = createBreathingCircle({ size: 220 });
  circleEl.appendChild(circleContainer);
  resetCircle(circleContainer);
  
  // Event listeners
  container.querySelector('#technique-selector').addEventListener('click', handleTechniqueSelect);
  startBtn.addEventListener('click', startSession);
  pauseBtn.addEventListener('click', togglePause);
  stopBtn.addEventListener('click', stopSession);
  container.querySelector('#restart-btn')?.addEventListener('click', resetUI);
}

export function unmount() {
  stopSession();
  container = null;
}

function handleTechniqueSelect(e) {
  const btn = e.target.closest('[data-technique]');
  if (!btn || isRunning) return;
  
  currentTechnique = btn.dataset.technique;
  
  // Update button styles
  container.querySelectorAll('.technique-btn').forEach(b => {
    const isActive = b.dataset.technique === currentTechnique;
    b.className = `technique-btn px-4 py-2 rounded-full text-sm font-medium transition-all ${
      isActive 
        ? 'bg-primary text-white shadow-md' 
        : 'bg-surface text-text-muted border border-border hover:border-primary'
    }`;
  });
  
  // Update description
  container.querySelector('#technique-description').textContent = 
    TECHNIQUES[currentTechnique].description;
  
  // Update cycle count
  cycleText.textContent = `${TECHNIQUES[currentTechnique].cycles} cycles`;
}

function startSession() {
  const technique = TECHNIQUES[currentTechnique];
  
  isRunning = true;
  isPaused = false;
  currentCycle = 0;
  currentPhaseIndex = 0;
  sessionStartTime = Date.now();
  startStress = state.stress;
  
  // Update UI
  startBtn.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  stopBtn.classList.remove('hidden');
  container.querySelector('#session-summary').classList.add('hidden');
  
  // Disable technique selector
  container.querySelectorAll('.technique-btn').forEach(b => b.disabled = true);
  
  // Start first phase
  startPhase();
}

function startPhase() {
  const technique = TECHNIQUES[currentTechnique];
  const phase = technique.phases[currentPhaseIndex];
  
  phaseStartTime = Date.now();
  phaseText.textContent = phase.name;
  
  // Set phase color
  const phaseType = phase.name.toLowerCase().includes('inhale') ? 'inhale' 
    : phase.name.toLowerCase().includes('exhale') ? 'exhale' 
    : 'hold';
  setCirclePhase(circleContainer, phaseType);
  
  // Update cycle display
  cycleText.textContent = `Cycle ${currentCycle + 1} of ${technique.cycles}`;
  
  // Start animation loop
  animationFrame = requestAnimationFrame(updateAnimation);
}

function updateAnimation() {
  if (!isRunning || isPaused) return;
  
  const technique = TECHNIQUES[currentTechnique];
  const phase = technique.phases[currentPhaseIndex];
  const elapsed = Date.now() - phaseStartTime;
  const progress = Math.min(elapsed / phase.duration, 1);
  
  // Update timer display
  const remaining = Math.max(0, Math.ceil((phase.duration - elapsed) / 1000));
  timerText.textContent = remaining.toString();
  
  // Update circle
  const isExpanding = phase.name.toLowerCase().includes('inhale');
  const circleProgress = isExpanding ? progress : (1 - progress);
  setCircleProgress(circleContainer, circleProgress);
  setCircleContent(circleContainer, remaining.toString(), phase.name);
  
  // Check if phase complete
  if (progress >= 1) {
    nextPhase();
  } else {
    animationFrame = requestAnimationFrame(updateAnimation);
  }
}

function nextPhase() {
  const technique = TECHNIQUES[currentTechnique];
  
  currentPhaseIndex++;
  
  // Check if cycle complete
  if (currentPhaseIndex >= technique.phases.length) {
    currentPhaseIndex = 0;
    currentCycle++;
    
    // Check if all cycles complete
    if (currentCycle >= technique.cycles) {
      completeSession();
      return;
    }
  }
  
  startPhase();
}

function togglePause() {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
  
  if (!isPaused) {
    // Adjust phase start time to account for pause
    phaseStartTime = Date.now() - (Date.now() - phaseStartTime);
    animationFrame = requestAnimationFrame(updateAnimation);
  }
}

function stopSession() {
  isRunning = false;
  isPaused = false;
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  
  resetUI();
}

function completeSession() {
  isRunning = false;
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  
  const duration = Math.round((Date.now() - sessionStartTime) / 1000);
  const endStress = state.stress;
  const stressChange = startStress - endStress;
  
  // Update summary
  const summary = container.querySelector('#session-summary');
  summary.querySelector('#summary-duration').textContent = formatDuration(duration);
  summary.querySelector('#summary-cycles').textContent = currentCycle.toString();
  
  const stressEl = summary.querySelector('#summary-stress');
  stressEl.textContent = stressChange >= 0 ? `-${stressChange}` : `+${Math.abs(stressChange)}`;
  stressEl.className = `text-2xl font-bold ${stressChange >= 0 ? 'text-stress-calm' : 'text-stress-high'}`;
  
  // Show summary
  summary.classList.remove('hidden');
  
  // Hide controls
  startBtn.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  stopBtn.classList.add('hidden');
  
  // Save session to IndexedDB
  saveBreathingSession({
    technique: currentTechnique,
    duration,
    cycles: currentCycle,
    startStress,
    endStress,
  }).catch(err => console.warn('Failed to save session:', err));
  
  // Set circle to complete state
  setCircleProgress(circleContainer, 1);
  setCirclePhase(circleContainer, 'inhale');
  setCircleContent(circleContainer, '✓', 'Complete');
}

function resetUI() {
  isRunning = false;
  isPaused = false;
  currentCycle = 0;
  currentPhaseIndex = 0;
  
  // Reset displays
  phaseText.textContent = 'Ready';
  timerText.textContent = '0:00';
  cycleText.textContent = `${TECHNIQUES[currentTechnique].cycles} cycles`;
  
  // Reset buttons
  startBtn.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  pauseBtn.textContent = 'Pause';
  stopBtn.classList.add('hidden');
  
  // Hide summary
  container.querySelector('#session-summary').classList.add('hidden');
  
  // Enable technique selector
  container.querySelectorAll('.technique-btn').forEach(b => b.disabled = false);
  
  // Reset circle
  resetCircle(circleContainer);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
