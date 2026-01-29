// ===========================================
// Mock Data Generator for Testing
// Seeds IndexedDB with representative stress data
// ===========================================

import { 
  saveHourlySummaries, 
  saveAnnotation, 
  saveBreathingSession,
  getTodayDate,
  getDateDaysAgo,
  getWeekDates,
  clearAllData
} from './storage.js';

/**
 * Seed the database with 7 days of realistic-looking data
 */
export async function seedMockData() {
  console.log('Seeding mock data...');
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4be791be-7c0d-4868-b533-efa3ddab59ff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'mock.js:seedMockData',message:'Starting mock data seed',data:{startTime:Date.now()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
  
  // 1. Clear existing data first
  await clearAllData();
  
  const dates = getWeekDates();
  
  // 2. Generate hourly summaries for each day
  // For testing, generate full 24 hours for ALL days including today
  for (const date of dates) {
    const summaries = [];
    
    // Determine daily pattern
    // Some days are more stressful than others
    const dayFactor = 0.5 + Math.random(); // 0.5 to 1.5
    
    // Generate all 24 hours for proper line chart visualization
    const maxHour = 23;
    
    for (let h = 0; h <= maxHour; h++) {
      // Circadian stress pattern: higher in morning/afternoon, lower at night
      let baseStress = 20;
      if (h >= 6 && h <= 7) baseStress = 30;   // Wake up
      if (h >= 8 && h <= 10) baseStress = 50;  // Morning rush
      if (h >= 11 && h <= 13) baseStress = 40; // Midday
      if (h >= 14 && h <= 17) baseStress = 60; // Afternoon peak
      if (h >= 18 && h <= 20) baseStress = 35; // Evening wind down
      if (h >= 21 && h <= 23) baseStress = 25; // Pre-sleep
      if (h >= 0 && h <= 5) baseStress = 15;   // Sleep
      
      const avgStress = Math.min(100, Math.max(0, Math.round((baseStress + (Math.random() * 20 - 10)) * dayFactor)));
      const peakStress = Math.min(100, avgStress + Math.round(Math.random() * 15));
      const highStressMins = avgStress > 50 ? Math.round(Math.random() * 30) : 0;
      
      summaries.push({
        hour: h,
        avgStress,
        peakStress,
        highStressMins,
        avgHR: 60 + Math.round(avgStress / 2) + Math.round(Math.random() * 10),
        avgHRV: 80 - Math.round(avgStress / 2) + Math.round(Math.random() * 20),
        avgGSR: 2000 + (avgStress * 10),
        valid: true,  // All generated hours are valid
        flags: 1 // bit 0 = valid
      });
    }
    
    await saveHourlySummaries(summaries, date);
  }
  
  // 3. Add some annotations for today at specific hours
  const today = getTodayDate();
  
  const annotationHours = [
    { text: 'Morning coffee ☕', hour: 8 },
    { text: 'Busy meeting 💼', hour: 10 },
    { text: 'Lunch break 🍽️', hour: 12 },
    { text: 'Afternoon focus 💻', hour: 15 },
    { text: 'Evening walk 🚶‍♂️', hour: 18 },
  ];
  
  for (const ann of annotationHours) {
    const timestamp = new Date(`${today}T${String(ann.hour).padStart(2, '0')}:30:00`).getTime();
    await saveAnnotation({
      text: ann.text,
      timestamp,
      stressLevel: 30 + Math.round(Math.random() * 40)
    });
  }
  
  // 4. Add some breathing sessions spread across the week
  const techniques = ['4-7-8', 'Box', 'Quick Reset'];
  for (let i = 0; i < 5; i++) {
    const daysAgo = Math.floor(Math.random() * 7);
    const sessionStress = 60 + Math.floor(Math.random() * 25);
    
    await saveBreathingSession({
      technique: techniques[Math.floor(Math.random() * techniques.length)],
      duration: 120 + Math.floor(Math.random() * 300),
      cycles: 4 + Math.floor(Math.random() * 6),
      startStress: sessionStress,
      endStress: Math.max(20, sessionStress - 15 - Math.floor(Math.random() * 20)),
    });
  }
  
  console.log('Mock data seeding complete!');
  console.log(`- Generated data for ${dates.length} days`);
  console.log(`- Each day: 24 hours of data`);
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4be791be-7c0d-4868-b533-efa3ddab59ff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'mock.js:seedMockData',message:'Mock data seed COMPLETE',data:{daysGenerated:dates.length,dates:dates},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
}
