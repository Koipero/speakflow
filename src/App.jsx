import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'

// --- Gemini API Config ---
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// --- IndexedDB Cache Setup ---
const DB_NAME = 'SpeakFlowCacheDB_v2';
const STORE_NAME = 'AudioCache';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

const getCachedAudio = async (key) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB get error:', err);
    return null;
  }
};

const setCachedAudio = async (key, blob) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(blob, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB set error:', err);
  }
};

const addWavHeader = (pcmData, sampleRate = 24000) => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = new ArrayBuffer(44 + pcmData.byteLength);
  const view = new DataView(buffer);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.byteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.byteLength, true);
  new Uint8Array(buffer, 44).set(pcmData);
  return buffer;
};

const DEFAULT_VOICES = [
  { voice_id: 'Puck', name: 'Puck (Male)' },
  { voice_id: 'Charon', name: 'Charon (Male)' },
  { voice_id: 'Kore', name: 'Kore (Female)' },
  { voice_id: 'Fenrir', name: 'Fenrir (Male)' },
  { voice_id: 'Aoede', name: 'Aoede (Female)' },
];

// --- Sample Texts (TOEIC Part 4 level, 120-150 words) ---
const SAMPLE_TEXTS = [
  {
    id: 1,
    title: "Company Announcement",
    category: "Business",
    wordCount: 135,
    text: `Good morning, everyone. I'm pleased to announce that our company has been selected as a finalist for the National Innovation Award. This achievement reflects the hard work and dedication of every team member over the past year. As part of the evaluation process, a panel of judges will visit our headquarters next Thursday. I'd like all department heads to prepare a brief presentation highlighting their team's key contributions. Please submit your slides to the marketing department by Tuesday afternoon. Additionally, we will be hosting a reception for the judges after the tour. If you'd like to volunteer to help with the event planning, please contact Sarah in Human Resources. Let's show them what makes our company truly exceptional.`
  },
  {
    id: 2,
    title: "Product Launch",
    category: "Marketing",
    wordCount: 142,
    text: `Thank you all for joining today's meeting. I'm excited to share the timeline for our upcoming product launch. After months of development and testing, we are finally ready to introduce the new software platform to the market. The official launch date is set for March fifteenth. Before that, we need to complete several important tasks. First, the quality assurance team will conduct final testing this week. Second, our marketing department will begin the promotional campaign on social media starting next Monday. Third, I need each sales representative to schedule demonstrations with their top ten clients by the end of this month. Training sessions for the new platform will be available starting February first. Please sign up through the company portal.`
  },
  {
    id: 3,
    title: "Travel Advisory",
    category: "Travel",
    wordCount: 128,
    text: `Attention, passengers. Due to severe weather conditions in the northeastern region, several flights have been delayed or rescheduled. Flight seven twenty-three to Boston, originally scheduled for departure at two fifteen, has been delayed until approximately four thirty. Passengers on this flight should remain in the terminal and listen for further announcements. If you need to rebook your flight, our customer service representatives are available at Gate B twelve. Alternatively, you can use the airline's mobile application to check for available seats on later flights. Complimentary meal vouchers will be distributed at the information desk for passengers experiencing delays of more than two hours. We sincerely apologize for the inconvenience and appreciate your patience.`
  },
  {
    id: 4,
    title: "Training Workshop",
    category: "HR",
    wordCount: 138,
    text: `Welcome to this month's professional development workshop. Today's session will focus on effective communication strategies in the workplace. Strong communication skills are essential for building productive relationships with colleagues, clients, and stakeholders. During the first hour, we will explore different communication styles and how to adapt your approach based on your audience. After a short break, we will practice active listening techniques through role-playing exercises. I encourage everyone to participate actively, as these skills improve significantly with practice. At the end of the workshop, you will receive a reference guide that summarizes the key concepts we covered today. Please also complete the feedback survey before you leave, as your input helps us design better training programs.`
  },
  {
    id: 5,
    title: "Office Renovation",
    category: "Facilities",
    wordCount: 131,
    text: `I'd like to update everyone on the status of our office renovation project. Starting next Monday, construction will begin on the third floor to create a new collaborative workspace. During the renovation period, which is expected to last approximately three weeks, employees currently working on the third floor will be temporarily relocated to the second floor conference rooms. Please pack your personal belongings and label your boxes by Friday afternoon. The facilities team will handle the transportation of computer equipment and furniture over the weekend. While we understand this may cause some disruption, the new space will include modern meeting rooms, quiet zones for focused work, and a relaxation area. We believe these improvements will greatly enhance our work environment.`
  },
  {
    id: 6,
    title: "Tech Conference Keynote",
    category: "Technology",
    wordCount: 139,
    text: `Good afternoon, and welcome to the annual technology summit. This year's theme is "Innovation Through Collaboration." Over the next two days, you will hear from industry leaders who are shaping the future of artificial intelligence, cloud computing, and cybersecurity. Our opening keynote speaker is Dr. Rebecca Chen, who will discuss how machine learning is transforming healthcare diagnostics. Following her presentation, we will have breakout sessions in rooms A through D. I encourage you to attend at least two sessions outside your area of expertise. Networking opportunities will be available during lunch and at the evening reception on the rooftop terrace. Please download our conference application to access the full schedule and connect with other attendees. We hope you find this event both informative and inspiring.`
  },
  {
    id: 7,
    title: "Health and Wellness Program",
    category: "Health",
    wordCount: 134,
    text: `Attention, all employees. I'm pleased to announce the launch of our new corporate wellness program starting next month. The program includes free health screenings, weekly yoga classes during lunch breaks, and access to an online mental health support platform. Research shows that companies investing in employee wellness see a twenty percent increase in productivity and a significant reduction in sick days. To participate, simply register through the employee portal by the end of this week. Additionally, we are introducing standing desks and ergonomic chairs for all departments. If you have any specific health concerns or accommodation requests, please speak with our wellness coordinator, Dr. James Martinez, who will be available in the HR office every Wednesday afternoon.`
  },
  {
    id: 8,
    title: "Quarterly Financial Report",
    category: "Finance",
    wordCount: 141,
    text: `Thank you for attending this quarterly financial review. I'm happy to report that our revenue for the third quarter exceeded projections by twelve percent, reaching forty-five million dollars. This growth was primarily driven by strong performance in our international markets, particularly in Southeast Asia and Europe. Operating expenses remained within budget, and our profit margin improved by three percentage points compared to the same period last year. Looking ahead, we expect continued growth in the fourth quarter, supported by the upcoming product launch and expansion into two new markets. However, I should note that currency fluctuations and rising material costs remain potential risks. The detailed financial statements have been distributed to all department heads for review.`
  },
  {
    id: 9,
    title: "Online Learning Platform",
    category: "Education",
    wordCount: 137,
    text: `Welcome to the orientation session for our new online learning platform. This system has been designed to provide flexible, self-paced professional development opportunities for all employees. The platform offers over two hundred courses covering topics such as leadership, project management, data analysis, and foreign languages. Each course includes video lectures, interactive quizzes, and downloadable resources. Upon completion, you will receive a digital certificate that can be added to your professional profile. We recommend dedicating at least two hours per week to online learning. Your manager will work with you to identify courses that align with your career development goals. Technical support is available twenty-four hours a day through the help desk portal.`
  },
  {
    id: 10,
    title: "Store Grand Opening",
    category: "Retail",
    wordCount: 132,
    text: `Good morning, team. As you know, our flagship store grand opening is scheduled for this Saturday. We expect over five hundred visitors during the first day, so preparation is essential. All display areas must be fully stocked and arranged according to the new visual merchandising guidelines by Friday evening. The marketing team has confirmed that local media coverage will begin at nine in the morning, so please ensure the entrance area is spotless. Special promotional discounts of twenty percent will apply to all items during the opening weekend. Customer service representatives should be familiar with our loyalty program registration process. A brief team meeting will be held at eight thirty on Saturday morning to review final assignments and answer any questions.`
  },
  {
    id: 11,
    title: "Supply Chain Update",
    category: "Business",
    wordCount: 136,
    text: `I'd like to provide an important update regarding our supply chain operations. Due to recent port congestion on the west coast, shipments from our Asian suppliers have experienced delays of approximately two to three weeks. To minimize the impact on production schedules, we have activated our secondary suppliers in Mexico and established temporary air freight arrangements for critical components. The logistics team is monitoring the situation daily and will provide weekly updates to all affected departments. In the meantime, I ask that production managers review their inventory levels and submit revised forecasts by the end of this week. We are also exploring long-term solutions including regional distribution centers to improve our resilience against future disruptions.`
  },
  {
    id: 12,
    title: "Customer Satisfaction Survey",
    category: "Marketing",
    wordCount: 130,
    text: `I wanted to share the results of our annual customer satisfaction survey, which was completed by over three thousand respondents. Overall satisfaction scores increased by eight percent compared to last year, with particularly strong ratings in product quality and customer support. However, delivery times received lower scores, with thirty-five percent of customers reporting delays longer than expected. To address this, we will be implementing a new order tracking system next quarter and adding two additional distribution centers. I'd like to thank the customer service team for their outstanding performance. Their average response time decreased to under four hours. Detailed results by region and product category have been shared in the attached report.`
  },
  {
    id: 13,
    title: "Airport Lounge Announcement",
    category: "Travel",
    wordCount: 128,
    text: `Welcome to the Premium Traveler's Lounge. We'd like to inform you about our available services and today's schedule. Complimentary beverages and light meals are served at the buffet station from six in the morning until eleven at night. High-speed wireless internet is available throughout the lounge, and the access code is displayed on the screens near the entrance. Private meeting rooms can be reserved at the reception desk for up to two hours. Shower facilities are located on the second level and are available on a first-come, first-served basis. Please note that Gate changes are announced on our overhead monitors. Should you need any assistance, our staff members are happy to help. We wish you a pleasant journey.`
  },
  {
    id: 14,
    title: "Employee Benefits Update",
    category: "HR",
    wordCount: 140,
    text: `Good afternoon, everyone. I'm here to discuss the updates to our employee benefits package that will take effect starting January first. Based on feedback from the employee survey, we are making several significant improvements. First, dental and vision coverage will now be included in the standard health plan at no additional cost. Second, the company will match retirement contributions up to eight percent, an increase from the previous five percent. Third, we are introducing a new childcare assistance program that provides monthly subsidies for employees with children under the age of six. The enrollment period for these new benefits will open on December first and close on December twenty-first. Information sessions will be held next week in the main auditorium. Please bring any questions you may have.`
  },
  {
    id: 15,
    title: "Building Security Notice",
    category: "Facilities",
    wordCount: 133,
    text: `This is an important notice regarding updates to our building security procedures. Starting next Monday, all employees will be required to use the new electronic badge system to enter the building. The old key card system will be deactivated at midnight on Sunday. Please visit the security office on the ground floor to collect your new badge before Friday. The new system includes contactless entry at all doors, elevator access control, and emergency notification features. Visitors must now register online at least twenty-four hours in advance and will receive a temporary digital pass. Additionally, security cameras have been upgraded throughout the parking garage and lobby areas. If you encounter any issues with your new badge, please contact the facilities help desk immediately.`
  }
];

// --- Category list for filter ---
const CATEGORIES = ['All', 'Business', 'Marketing', 'Travel', 'HR', 'Facilities', 'Technology', 'Health', 'Finance', 'Education', 'Retail'];

// --- Practice Mode Config ---
const PRACTICE_MODES = {
  overlapping: {
    key: 'overlapping',
    icon: '\u{1F50A}',
    title: '\u30AA\u30FC\u30D0\u30FC\u30E9\u30C3\u30D4\u30F3\u30B0',
    subtitle: '\u97F3\u58F0\u306B\u91CD\u306D\u3066\u8AAD\u3080',
    target: 10,
    color: 'blue',
    description: '\u304A\u624B\u672C\u306E\u97F3\u58F0\u306B0.1\u79D2\u3082\u9045\u308C\u305A\u306B\u3001\u30D4\u30C3\u30BF\u30EA\u91CD\u306D\u3066\u8AAD\u307F\u307E\u3059\u3002\u97F3\u58F0\u3092\u518D\u751F\u3057\u306A\u304C\u3089\u3001\u540C\u6642\u306B\u58F0\u306B\u51FA\u3057\u3066\u8AAD\u307F\u307E\u3057\u3087\u3046\u3002\u30D3\u30B8\u30CD\u30B9\u82F1\u8A9E\u306E\u30EA\u30BA\u30E0\u3092\u8133\u306B\u53E9\u304D\u8FBC\u3080\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0\u3067\u3059\u3002'
  },
  readLookup: {
    key: 'readLookup',
    icon: '\u{1F440}',
    title: '\u30EA\u30FC\u30C9\uFF06\u30EB\u30C3\u30AF\u30A2\u30C3\u30D7',
    subtitle: '\u8AAD\u3093\u3067\u9854\u3092\u4E0A\u3052\u3066\u8A00\u3046',
    target: 5,
    color: 'purple',
    description: '\u4E00\u6587\u3092\u8AAD\u307F\u3001\u9854\u3092\u4E0A\u3052\u3066\uFF08\u30C6\u30AD\u30B9\u30C8\u3092\u898B\u305A\u306B\uFF09\u5B99\u306B\u5411\u304B\u3063\u3066\u305D\u306E\u4E00\u6587\u3092\u8A00\u3044\u307E\u3059\u3002\u6587\u7AE0\u69CB\u7BC9\u529B\u3068\u4FDD\u6301\u529B\u3092\u935B\u3048\u308B\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0\u3067\u3059\u3002\u30C6\u30AD\u30B9\u30C8\u306E\u8868\u793A/\u975E\u8868\u793A\u3092\u5207\u308A\u66FF\u3048\u3066\u7DF4\u7FD2\u3057\u307E\u3057\u3087\u3046\u3002'
  },
  shadowing: {
    key: 'shadowing',
    icon: '\u{1F3A7}',
    title: '\u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0',
    subtitle: '\u97F3\u58F0\u3092\u8FFD\u3044\u304B\u3051\u3066\u767A\u97F3',
    target: 5,
    color: 'cyan',
    description: '\u30C6\u30AD\u30B9\u30C8\u3092\u898B\u305A\u306B\u3001\u97F3\u58F0\u3060\u3051\u3092\u983C\u308A\u306B\u5F71\u306E\u3088\u3046\u306B\u8FFD\u3044\u304B\u3051\u3066\u767A\u97F3\u3057\u307E\u3059\u3002\u30C6\u30AD\u30B9\u30C8\u306F\u975E\u8868\u793A\u306E\u72B6\u614B\u3067\u3001\u97F3\u58F0\u3092\u518D\u751F\u3057\u3066\u5F8C\u3092\u8FFD\u3044\u304B\u3051\u307E\u3057\u3087\u3046\u3002\u300C\u610F\u5473\u300D\u306B\u96C6\u4E2D\u3059\u308B\u30B3\u30F3\u30C6\u30F3\u30C4\u30FB\u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0\u3067\u3059\u3002'
  }
};

// --- localStorage helpers ---
const LS_PRACTICE_LOG = 'speakflow_practice_log';
const LS_SPEED_RECORDS = 'speakflow_speed_records';
const LS_MASTERY = 'speakflow_mastery';

const loadJSON = (key, fallback = {}) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

const saveJSON = (key, data) => {
  localStorage.setItem(key, JSON.stringify(data));
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Mastery calculation ---
const computeMastery = (textId) => {
  const mastery = loadJSON(LS_MASTERY);
  const speedRecords = loadJSON(LS_SPEED_RECORDS);
  const entry = mastery[`text_${textId}`] || { modes: {} };
  const modes = entry.modes || {};
  const modesUsed = Object.keys(modes).filter(m => (modes[m] || 0) > 0);
  const allModes = Object.keys(PRACTICE_MODES);
  const allModesUsed = allModes.every(m => (modes[m] || 0) > 0);
  const totalCount = Object.values(modes).reduce((a, b) => a + b, 0);

  // Find max speed across all mode records for this text
  let maxSpeed = 0;
  allModes.forEach(m => {
    const rec = speedRecords[`text_${textId}_${m}`];
    if (rec && rec.maxSpeed > maxSpeed) maxSpeed = rec.maxSpeed;
  });

  // Check target completion
  const allTargetsMet = allModes.every(m => (modes[m] || 0) >= PRACTICE_MODES[m].target);

  if (allTargetsMet && maxSpeed >= 1.2) return 5;
  if (allTargetsMet && maxSpeed >= 1.0) return 4;
  if (allModesUsed && totalCount >= 10) return 3;
  if (modesUsed.length >= 2) return 2;
  if (modesUsed.length >= 1) return 1;
  return 0;
};

const getMasteryStars = (level) => {
  return '\u2605'.repeat(level) + '\u2606'.repeat(5 - level);
};

// --- Week helpers for chart ---
const getWeekRange = (weeksAgo) => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() - day - (weeksAgo * 7));
  endOfWeek.setHours(23, 59, 59, 999);
  const startOfWeek = new Date(endOfWeek);
  startOfWeek.setDate(endOfWeek.getDate() - 6);
  startOfWeek.setHours(0, 0, 0, 0);
  if (weeksAgo === 0) {
    // Current week: start from last Sunday (or Monday), end today
    const today = new Date(now);
    today.setHours(23, 59, 59, 999);
    const startOfThisWeek = new Date(now);
    startOfThisWeek.setDate(now.getDate() - day);
    startOfThisWeek.setHours(0, 0, 0, 0);
    return { start: startOfThisWeek, end: today };
  }
  return { start: startOfWeek, end: endOfWeek };
};

const getWeekMinutes = (practiceLog, weeksAgo) => {
  const { start, end } = getWeekRange(weeksAgo);
  let total = 0;
  Object.entries(practiceLog).forEach(([dateStr, data]) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (d >= start && d <= end) {
      total += (data.totalMinutes || 0);
    }
  });
  return total;
};

const getWeekLabel = (weeksAgo) => {
  if (weeksAgo === 0) return '\u4ECA\u9031';
  if (weeksAgo === 1) return '1\u9031\u524D';
  return `${weeksAgo}\u9031\u524D`;
};

function App() {
  // API Key state
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Text state
  const [text, setText] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [selectedTextId, setSelectedTextId] = useState(null);

  // TTS state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [voices, setVoices] = useState(DEFAULT_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState(DEFAULT_VOICES[0].voice_id);
  const [modelId, setModelId] = useState('gemini-2.5-flash-preview-tts');
  const audioRef = useRef(null);
  const audioBlobUrlRef = useRef(null);
  const audioCacheRef = useRef({});

  // Practice state
  const [activeMode, setActiveMode] = useState('overlapping');
  const [practiceCount, setPracticeCount] = useState({
    overlapping: 0,
    readLookup: 0,
    shadowing: 0
  });
  const [textVisible, setTextVisible] = useState(true);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentences, setSentences] = useState([]);

  // Guide state
  const [showGuide, setShowGuide] = useState(false);
  const [expandedGuideSection, setExpandedGuideSection] = useState(null);

  // Error/Status
  const [errorMsg, setErrorMsg] = useState('');

  // Feature 1: Category filter
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Feature 2: Calendar
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calendarPopover, setCalendarPopover] = useState(null); // dateStr or null
  const [practiceLog, setPracticeLog] = useState(() => loadJSON(LS_PRACTICE_LOG));

  // Feature 4: Speed challenge
  const [speedRecords, setSpeedRecords] = useState(() => loadJSON(LS_SPEED_RECORDS));
  const [newRecordAnim, setNewRecordAnim] = useState(false);

  // Feature 5: Mastery
  const [masteryData, setMasteryData] = useState(() => loadJSON(LS_MASTERY));
  const [masterBadgeAnim, setMasterBadgeAnim] = useState(null); // textId or null

  // Filtered texts
  const filteredTexts = useMemo(() => {
    if (selectedCategory === 'All') return SAMPLE_TEXTS;
    return SAMPLE_TEXTS.filter(t => t.category === selectedCategory);
  }, [selectedCategory]);

  // Check API key on mount
  useEffect(() => {
    if (!apiKey) {
      setShowApiSetup(true);
    }
  }, []);

  // Parse sentences when text changes
  useEffect(() => {
    if (text.trim()) {
      const parsed = text
        .replace(/([.!?])\s+/g, '$1|||')
        .split('|||')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      setSentences(parsed);
      setCurrentSentenceIndex(0);
    } else {
      setSentences([]);
    }
  }, [text]);

  // Word count
  useEffect(() => {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    setWordCount(words.length);
  }, [text]);

  // Cleanup audio blob URL
  useEffect(() => {
    return () => {
      Object.values(audioCacheRef.current).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  // --- Gemini TTS ---
  const speak = useCallback(async (textToSpeak) => {
    if (!apiKey) {
      setShowApiSetup(true);
      setErrorMsg('API\u30AD\u30FC\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044');
      return;
    }
    if (!textToSpeak.trim()) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setIsLoading(true);
    setIsPlaying(false);
    setErrorMsg('');

    try {
      const cacheKey = `${modelId}_${selectedVoiceId}_${textToSpeak}`;
      let audioUrl = audioCacheRef.current[cacheKey];

      if (!audioUrl) {
        const cachedBlob = await getCachedAudio(cacheKey);

        if (cachedBlob) {
          audioUrl = URL.createObjectURL(cachedBlob);
          audioCacheRef.current[cacheKey] = audioUrl;
        } else {
          const response = await fetch(
            `${GEMINI_API_URL}/${modelId}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: textToSpeak }] }],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: selectedVoiceId }
                    }
                  }
                }
              })
            }
          );

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `API Error: ${response.status}`);
          }

          const data = await response.json();
          const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

          if (!audioPart || !audioPart.inlineData) {
            const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
            throw new Error(`\u97F3\u58F0\u30C7\u30FC\u30BF\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F`);
          }

          const base64Audio = audioPart.inlineData.data;
          const byteCharacters = atob(base64Audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);

          let audioData = byteArray;
          const isWav = byteArray.length > 4 &&
                        byteArray[0] === 82 && byteArray[1] === 73 &&
                        byteArray[2] === 70 && byteArray[3] === 70;

          if (!isWav) {
            audioData = addWavHeader(byteArray, 24000);
          }

          const audioBlob = new Blob([audioData], { type: 'audio/wav' });
          await setCachedAudio(cacheKey, audioBlob);
          audioUrl = URL.createObjectURL(audioBlob);
          audioCacheRef.current[cacheKey] = audioUrl;
        }
      }

      audioBlobUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      audio.playbackRate = speed;
      audioRef.current = audio;

      audio.onplay = () => { setIsPlaying(true); setIsLoading(false); };
      audio.onended = () => { setIsPlaying(false); };
      audio.onerror = () => { setIsPlaying(false); setIsLoading(false); setErrorMsg('\u97F3\u58F0\u306E\u518D\u751F\u306B\u5931\u6557\u3057\u307E\u3057\u305F'); };

      await audio.play();
    } catch (err) {
      setIsLoading(false);
      setIsPlaying(false);
      if (err.message.includes('API_KEY_INVALID') || err.message.includes('400')) {
        setErrorMsg('API\u30AD\u30FC\u304C\u7121\u52B9\u3067\u3059\u3002\u6B63\u3057\u3044\u30AD\u30FC\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002');
        setShowApiSetup(true);
      } else {
        setErrorMsg(`\u30A8\u30E9\u30FC: ${err.message}`);
      }
      console.error('Gemini TTS Error:', err);
    }
  }, [apiKey, selectedVoiceId, modelId, speed]);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsLoading(false);
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const handlePlayAll = () => {
    if (isPlaying) {
      stopSpeaking();
    } else if (text.trim()) {
      speak(text);
    }
  };

  const handlePlaySentence = () => {
    if (sentences[currentSentenceIndex]) {
      speak(sentences[currentSentenceIndex]);
    }
  };

  const handleSampleSelect = (sample) => {
    setText(sample.text);
    setSelectedTextId(sample.id);
    setPracticeCount({ overlapping: 0, readLookup: 0, shadowing: 0 });
  };

  // --- Feature 2 & 5: Count up with logging ---
  const handleCountUp = (mode) => {
    setPracticeCount(prev => ({
      ...prev,
      [mode]: prev[mode] + 1
    }));

    // Update practice log in localStorage
    const today = getTodayStr();
    const log = loadJSON(LS_PRACTICE_LOG);
    if (!log[today]) {
      log[today] = { totalMinutes: 0, sessions: 0, modes: { overlapping: 0, readLookup: 0, shadowing: 0 } };
    }
    log[today].totalMinutes += 1; // ~1 min per practice
    log[today].sessions += 1;
    if (!log[today].modes) log[today].modes = { overlapping: 0, readLookup: 0, shadowing: 0 };
    log[today].modes[mode] = (log[today].modes[mode] || 0) + 1;
    saveJSON(LS_PRACTICE_LOG, log);
    setPracticeLog({ ...log });

    // Update mastery for sample texts
    if (selectedTextId) {
      const mastery = loadJSON(LS_MASTERY);
      const key = `text_${selectedTextId}`;
      if (!mastery[key]) mastery[key] = { level: 0, modes: {} };
      if (!mastery[key].modes) mastery[key].modes = {};
      mastery[key].modes[mode] = (mastery[key].modes[mode] || 0) + 1;
      mastery[key].level = computeMastery(selectedTextId);

      // Check if just reached level 5
      const prevLevel = masteryData[key]?.level || 0;
      saveJSON(LS_MASTERY, mastery);
      setMasteryData({ ...mastery });

      if (mastery[key].level === 5 && prevLevel < 5) {
        setMasterBadgeAnim(selectedTextId);
        setTimeout(() => setMasterBadgeAnim(null), 3000);
      }
    }
  };

  const handleCountReset = (mode) => {
    setPracticeCount(prev => ({
      ...prev,
      [mode]: 0
    }));
  };

  // --- Feature 4: Speed challenge ---
  const handleSpeedChallenge = () => {
    if (!selectedTextId) return;
    const recordKey = `text_${selectedTextId}_${activeMode}`;
    const records = loadJSON(LS_SPEED_RECORDS);
    const current = records[recordKey];
    const currentSpeed = speed;

    if (!current || currentSpeed > current.maxSpeed) {
      records[recordKey] = { maxSpeed: currentSpeed, achievedAt: getTodayStr() };
      saveJSON(LS_SPEED_RECORDS, records);
      setSpeedRecords({ ...records });

      // Also update mastery maxSpeed
      const mastery = loadJSON(LS_MASTERY);
      const mKey = `text_${selectedTextId}`;
      if (!mastery[mKey]) mastery[mKey] = { level: 0, modes: {} };
      mastery[mKey].maxSpeed = Math.max(mastery[mKey].maxSpeed || 0, currentSpeed);
      mastery[mKey].level = computeMastery(selectedTextId);
      saveJSON(LS_MASTERY, mastery);
      setMasteryData({ ...mastery });

      // Trigger new record animation
      setNewRecordAnim(true);
      setTimeout(() => setNewRecordAnim(false), 2000);
    }
  };

  const getSpeedRecordForCurrentText = () => {
    if (!selectedTextId) return null;
    const records = [];
    Object.keys(PRACTICE_MODES).forEach(mode => {
      const rec = speedRecords[`text_${selectedTextId}_${mode}`];
      if (rec) records.push({ mode, ...rec });
    });
    return records;
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('gemini_api_key', apiKeyInput.trim());
      setApiKey(apiKeyInput.trim());
      setShowApiSetup(false);
      setErrorMsg('');
    }
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setApiKeyInput('');
    setVoices(DEFAULT_VOICES);
    setShowApiSetup(true);
  };

  const getWordCountStatus = () => {
    if (wordCount >= 120 && wordCount <= 150) return 'optimal';
    if (wordCount > 150) return 'warning';
    return '';
  };

  const getProgressPercent = (mode) => {
    const target = PRACTICE_MODES[mode].target;
    return Math.min((practiceCount[mode] / target) * 100, 100);
  };

  // --- Calendar helpers ---
  const getCalendarDays = () => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  };

  const getDateStr = (day) => {
    const { year, month } = calendarMonth;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const getPracticeIntensity = (dateStr) => {
    const entry = practiceLog[dateStr];
    if (!entry) return 0;
    const mins = entry.totalMinutes || 0;
    if (mins >= 20) return 3;
    if (mins >= 10) return 2;
    if (mins > 0) return 1;
    return 0;
  };

  const calendarMonthName = () => {
    const { year, month } = calendarMonth;
    const months = ['1\u6708', '2\u6708', '3\u6708', '4\u6708', '5\u6708', '6\u6708', '7\u6708', '8\u6708', '9\u6708', '10\u6708', '11\u6708', '12\u6708'];
    return `${year}\u5E74 ${months[month]}`;
  };

  // --- Growth chart data ---
  const weeklyData = useMemo(() => {
    const data = [];
    for (let w = 3; w >= 0; w--) {
      data.push({
        label: getWeekLabel(w),
        minutes: getWeekMinutes(practiceLog, w)
      });
    }
    return data;
  }, [practiceLog]);

  const maxWeekMinutes = useMemo(() => Math.max(...weeklyData.map(d => d.minutes), 1), [weeklyData]);

  const growthComment = useMemo(() => {
    const thisWeek = weeklyData[3]?.minutes || 0;
    const lastWeek = weeklyData[2]?.minutes || 0;
    if (thisWeek === 0 && lastWeek === 0) {
      if (weeklyData.some(d => d.minutes > 0)) return '\u7DF4\u7FD2\u3092\u518D\u958B\u3057\u307E\u3057\u3087\u3046\uFF01';
      return '\u7DF4\u7FD2\u3092\u59CB\u3081\u307E\u3057\u3087\u3046\uFF01\u7D99\u7D9A\u304C\u529B\u306B\u306A\u308A\u307E\u3059\u{1F4AA}';
    }
    if (lastWeek === 0 && thisWeek > 0) return '\u7DF4\u7FD2\u3092\u59CB\u3081\u307E\u3057\u305F\uFF01\u7D99\u7D9A\u304C\u529B\u306B\u306A\u308A\u307E\u3059\u{1F4AA}';
    if (lastWeek > 0 && thisWeek > lastWeek) {
      const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
      return `\u5148\u9031\u3088\u308A${pct}%\u591A\u304F\u7DF4\u7FD2\u3057\u307E\u3057\u305F\uFF01\u{1F525}`;
    }
    if (lastWeek > 0 && thisWeek < lastWeek) {
      return '\u5148\u9031\u3088\u308A\u5C11\u306A\u3081\u3067\u3057\u305F\u3002\u4ECA\u9031\u3082\u9811\u5F35\u308A\u307E\u3057\u3087\u3046\uFF01';
    }
    return '\u826F\u3044\u30DA\u30FC\u30B9\u3067\u3059\uFF01\u7D99\u7D9A\u3057\u3066\u3044\u304D\u307E\u3057\u3087\u3046\u{1F4AA}';
  }, [weeklyData]);

  const currentMode = PRACTICE_MODES[activeMode];

  // Mastery levels for cards
  const getMasteryLevel = (textId) => {
    return computeMastery(textId);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">{'\u{1F399}\uFE0F'}</div>
        </div>
        <h1 className="app-title">SpeakFlow</h1>
        <p className="app-subtitle">
          {'\u82F1\u6587\u97F3\u8AAD\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0\u3067\u3001\u3042\u306A\u305F\u306E\u767A\u97F3\u529B\u3092\u98DB\u8E8D\u7684\u306B\u5411\u4E0A\u3055\u305B\u308B'}
        </p>
        <div className="api-status-bar">
          {apiKey ? (
            <button className="api-badge api-badge-connected" onClick={() => setShowApiSetup(true)}>
              <span className="api-badge-dot connected" />
              Gemini API {'\u63A5\u7D9A\u6E08\u307F'}
            </button>
          ) : (
            <button className="api-badge api-badge-disconnected" onClick={() => setShowApiSetup(true)}>
              <span className="api-badge-dot disconnected" />
              API{'\u30AD\u30FC\u672A\u8A2D\u5B9A'}
            </button>
          )}
        </div>
      </header>

      <div className="app-main-layout">
        <aside className="app-sidebar">
          {/* Profile & Guide Summary */}
          <section className="guide-summary-section">
        <div className="guide-summary-card">
          <div className="guide-summary-profile">
            <div className="guide-profile-header">
              <span className="guide-profile-icon">{'\u{1F4CB}'}</span>
              <div>
                <div className="guide-profile-title">{'\u3042\u306A\u305F\u306E\u30D7\u30ED\u30D5\u30A1\u30A4\u30EB'}</div>
                <div className="guide-profile-subtitle">{'\u73FE\u5728\u306E\u30EC\u30D9\u30EB\u306B\u6700\u9069\u5316\u3055\u308C\u305F\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0'}</div>
              </div>
            </div>
            <div className="guide-stats-row">
              <div className="guide-stat">
                <div className="guide-stat-value">790</div>
                <div className="guide-stat-label">TOEIC</div>
                <div className="guide-stat-detail">L425 / R365</div>
              </div>
              <div className="guide-stat-divider" />
              <div className="guide-stat">
                <div className="guide-stat-value amber">35-50</div>
                <div className="guide-stat-label">Versant</div>
                <div className="guide-stat-detail">{'\u4F38\u3073\u4EE3\u3042\u308A'}</div>
              </div>
              <div className="guide-stat-divider" />
              <div className="guide-stat">
                <div className="guide-stat-value rose">150</div>
                <div className="guide-stat-label">Speaking</div>
                <div className="guide-stat-detail">{'\u76EE\u6A19: 160+'}</div>
              </div>
            </div>
            <div className="guide-diagnosis">
              <span className="guide-diagnosis-icon">{'\u{1F4A1}'}</span>
              <span>{'\u97F3\u306F\u805E\u304D\u53D6\u308C\u308B\u304C\u3001\u53E3\u304C\u52D5\u304D\u3092\u899A\u3048\u3066\u3044\u306A\u3044\u72B6\u614B\u3002\u300C\u53D7\u4FE1\u2192\u767A\u4FE1\u300D\u3078\u306E\u56DE\u8DEF\u5207\u66FF\u304C\u5FC5\u8981\u3067\u3059\u3002'}</span>
            </div>
          </div>
          <button className="guide-toggle-btn" onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? '\u{1F4D6} \u7DF4\u7FD2\u30DE\u30CB\u30E5\u30A2\u30EB\u3092\u9589\u3058\u308B \u25B2' : '\u{1F4D6} \u7DF4\u7FD2\u30DE\u30CB\u30E5\u30A2\u30EB\u3092\u958B\u304F \u25BC'}
          </button>
        </div>
      </section>

      {/* Detailed Guide */}
      {showGuide && (
        <section className="guide-detail-section">
          <div className="guide-card">
            <h3 className="guide-card-title">{'\u23F1 \u6BCE\u65E5\u306E\u7DF4\u7FD2\u30E1\u30CB\u30E5\u30FC\uFF08\u7D0425\u301C30\u5206\uFF09'}</h3>
            <p className="guide-card-intro">{'\u4E00\u3064\u306E\u30C6\u30AD\u30B9\u30C8\uFF08120\u301C150\u8A9E\uFF09\u3092\u4F7F\u3044\u3001\u4EE5\u4E0B\u306E\u9806\u756A\u3067\u7DF4\u7FD2\u3057\u307E\u3059\u3002'}</p>

            <div className="guide-timeline">
              <div className="guide-timeline-item">
                <div className="guide-timeline-marker blue" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 1</div>
                  <div className="guide-timeline-title">{'\u30C6\u30AD\u30B9\u30C8\u306E\u5185\u5BB9\u7406\u89E3\uFF082\u5206\uFF09'}</div>
                  <div className="guide-timeline-desc">
                    {'\u307E\u305A\u30C6\u30AD\u30B9\u30C8\u3092\u9ED9\u8AAD\u3057\u3001\u610F\u5473\u3092\u5B8C\u5168\u306B\u7406\u89E3\u3057\u307E\u3059\u3002\u77E5\u3089\u306A\u3044\u5358\u8A9E\u304C\u3042\u308C\u3070\u8ABF\u3079\u3066\u304A\u304D\u307E\u3057\u3087\u3046\u3002'}<br />
                    <strong>{'\u30DD\u30A4\u30F3\u30C8:'}</strong> {'\u610F\u5473\u304C\u308F\u304B\u3089\u306A\u3044\u307E\u307E\u97F3\u8AAD\u3057\u3066\u3082\u52B9\u679C\u306F\u534A\u6E1B\u3057\u307E\u3059\u3002'}
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker blue" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 2</div>
                  <div className="guide-timeline-title">{'\u{1F50A} \u30AA\u30FC\u30D0\u30FC\u30E9\u30C3\u30D4\u30F3\u30B0 \u00D7 10\u56DE\uFF0810\u301C12\u5206\uFF09'}</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">{'\u3084\u308A\u65B9'}</div>
                      <ol className="guide-steps-list">
                        <li>{'\u300C\u25B6 \u97F3\u58F0\u3092\u518D\u751F\u300D\u30DC\u30BF\u30F3\u3092\u62BC\u3059'}</li>
                        <li>{'\u30C6\u30AD\u30B9\u30C8\u3092\u898B\u306A\u304C\u3089\u3001\u97F3\u58F0\u3068'}<strong>{'\u30D4\u30C3\u30BF\u30EA\u540C\u6642\u306B'}</strong>{'\u58F0\u3092\u51FA\u3059'}</li>
                        <li>{'\u97F3\u58F0\u306E\u901F\u5EA6\u30FB\u30EA\u30BA\u30E0\u30FB\u30A4\u30F3\u30C8\u30CD\u30FC\u30B7\u30E7\u30F3\u3092\u5B8C\u5168\u306B\u30B3\u30D4\u30FC\u3059\u308B'}</li>
                        <li>{'\u4E00\u56DE\u7D42\u308F\u3063\u305F\u3089\u300C\u2705 1\u56DE\u5B8C\u4E86\u300D\u3092\u30BF\u30C3\u30D7'}</li>
                        <li>{'10\u56DE\u7E70\u308A\u8FD4\u3059'}</li>
                      </ol>
                    </div>
                    <div className="guide-point-box blue">
                      <strong>{'\u{1F3AF} \u610F\u8B58\u3059\u308B\u30DD\u30A4\u30F3\u30C8:'}</strong><br />
                      {'\u30FB0.1\u79D2\u3082\u9045\u308C\u305A\u306B\u97F3\u58F0\u3068\u91CD\u306A\u308B\u3053\u3068'}<br />
                      {'\u30FB\u6700\u521D\u306E3\u56DE\u306F0.8x\u3067\u3001\u6163\u308C\u305F\u30891.0x\u306B\u30B9\u30D4\u30FC\u30C9\u30A2\u30C3\u30D7'}<br />
                      {'\u30FB\u30EA\u30F3\u30AD\u30F3\u30B0\uFF08\u97F3\u306E\u9023\u7D50: "picked up" \u2192 "\u30D4\u30AF\u30BF\u30C3\u30D7"\uFF09\u3092\u610F\u8B58'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker purple" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 3</div>
                  <div className="guide-timeline-title">{'\u{1F440} \u30EA\u30FC\u30C9\uFF06\u30EB\u30C3\u30AF\u30A2\u30C3\u30D7 \u00D7 5\u56DE\uFF088\u301C10\u5206\uFF09'}</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">{'\u3084\u308A\u65B9'}</div>
                      <ol className="guide-steps-list">
                        <li>{'\u300C\u30EA\u30FC\u30C9\uFF06\u30EB\u30C3\u30AF\u30A2\u30C3\u30D7\u300D\u30BF\u30D6\u3092\u9078\u629E'}</li>
                        <li>{'\u8868\u793A\u3055\u308C\u305F\u4E00\u6587\u3092\u8AAD\u3080'}</li>
                        <li>{'\u300C\u{1F440} \u30C6\u30AD\u30B9\u30C8\u3092\u96A0\u3059\u300D\u30DC\u30BF\u30F3\u3092\u62BC\u3059'}</li>
                        <li>{'\u9854\u3092\u4E0A\u3052\u3066\u3001\u5B99\u306B\u5411\u304B\u3063\u3066\u305D\u306E\u6587\u3092\u6697\u5531\u3059\u308B'}</li>
                        <li>{'\u300C\u6B21\u306E\u6587 \u2192\u300D\u3067\u6B21\u3078\u9032\u3080'}</li>
                        <li>{'\u5168\u6587\u3092\u901A\u3057\u30661\u56DE\u3002\u305D\u308C\u30925\u56DE\u7E70\u308A\u8FD4\u3059'}</li>
                      </ol>
                    </div>
                    <div className="guide-point-box purple">
                      <strong>{'\u{1F3AF} \u610F\u8B58\u3059\u308B\u30DD\u30A4\u30F3\u30C8:'}</strong><br />
                      {'\u30FB\u4E00\u8A9E\u4E00\u8A9E\u3067\u306F\u306A\u304F\u3001'}<strong>{'\u30C1\u30E3\u30F3\u30AF\uFF08\u610F\u5473\u306E\u304B\u305F\u307E\u308A\uFF09'}</strong>{'\u3067\u8A18\u61B6\u3059\u308B'}<br />
                      {'\u30FB\u5B8C\u74A7\u3067\u306A\u304F\u3066OK\u30028\u5272\u8A00\u3048\u305F\u3089\u6B21\u306E\u6587\u3078'}<br />
                      {'\u30FBVersant \u306E\u300C\u6587\u7AE0\u69CB\u7BC9\u529B\u300D\u3068\u300C\u4FDD\u6301\u529B\u300D\u304C\u935B\u3048\u3089\u308C\u308B'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker cyan" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 4</div>
                  <div className="guide-timeline-title">{'\u{1F3A7} \u30B3\u30F3\u30C6\u30F3\u30C4\u30FB\u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0 \u00D7 5\u56DE\uFF085\u301C8\u5206\uFF09'}</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">{'\u3084\u308A\u65B9'}</div>
                      <ol className="guide-steps-list">
                        <li>{'\u300C\u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0\u300D\u30BF\u30D6\u3092\u9078\u629E\uFF08\u30C6\u30AD\u30B9\u30C8\u81EA\u52D5\u975E\u8868\u793A\uFF09'}</li>
                        <li>{'\u300C\u25B6 \u97F3\u58F0\u3092\u518D\u751F\u300D\u3092\u62BC\u3059'}</li>
                        <li>{'\u30C6\u30AD\u30B9\u30C8\u3092\u898B\u305A\u306B\u3001\u97F3\u58F0\u306E0.5\u301C1\u79D2\u5F8C\u3092\u8FFD\u3044\u304B\u3051\u3066\u767A\u97F3'}</li>
                        <li>{'\u300C\u610F\u5473\u300D\u3092\u982D\u306E\u4E2D\u3067\u30A4\u30E1\u30FC\u30B8\u3057\u306A\u304C\u3089\u884C\u3046'}</li>
                        <li>{'5\u56DE\u7E70\u308A\u8FD4\u3059'}</li>
                      </ol>
                    </div>
                    <div className="guide-point-box cyan">
                      <strong>{'\u{1F3AF} \u610F\u8B58\u3059\u308B\u30DD\u30A4\u30F3\u30C8:'}</strong><br />
                      {'\u30FB\u97F3\u306E\u300C\u30E2\u30CE\u30DE\u30CD\u300D\u3067\u306F\u306A\u304F\u3001'}<strong>{'\u610F\u5473\u306E\u7406\u89E3'}</strong>{'\u306B\u96C6\u4E2D\u3059\u308B'}<br />
                      {'\u30FB\u6700\u521D\u306F\u3064\u307E\u3063\u3066\u3082OK\u3002\u56DE\u6570\u3092\u91CD\u306D\u3066\u6ED1\u3089\u304B\u306B'}<br />
                      {'\u30FB\u300C\u4F53\u304C\u52DD\u624B\u306B\u82F1\u8A9E\u3092\u767A\u3059\u308B\u300D\u611F\u899A\u304C\u30B4\u30FC\u30EB'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="guide-card">
            <button
              className="guide-accordion-btn"
              onClick={() => setExpandedGuideSection(expandedGuideSection === 'speed' ? null : 'speed')}
            >
              <span>{'\u{1F680} \u30B9\u30D4\u30FC\u30C9\u306E\u4E0A\u3052\u65B9\u30AC\u30A4\u30C9'}</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'speed' ? '\u25B2' : '\u25BC'}</span>
            </button>
            {expandedGuideSection === 'speed' && (
              <div className="guide-accordion-content">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>{'\u671F\u9593'}</th>
                      <th>{'\u63A8\u5968\u30B9\u30D4\u30FC\u30C9'}</th>
                      <th>{'\u76EE\u6A19'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Week 1-2</td><td>0.8x</td><td>{'\u97F3\u306E\u9023\u7D50\u30FB\u8131\u843D\u3092\u6B63\u78BA\u306B\u805E\u304D\u53D6\u308B'}</td></tr>
                    <tr><td>Week 3-4</td><td>0.9x</td><td>{'\u30AA\u30FC\u30D0\u30FC\u30E9\u30C3\u30D4\u30F3\u30B0\u3067\u9045\u308C\u305A\u306B\u4ED8\u3044\u3066\u3044\u3051\u308B'}</td></tr>
                    <tr><td>Week 5-6</td><td>{'\u30CD\u30A4\u30C6\u30A3\u30D6\u901F\u5EA6 1.0x'}</td><td>{'\u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0\u30678\u5272\u4EE5\u4E0A\u518D\u73FE\u3067\u304D\u308B'}</td></tr>
                    <tr><td>Week 7+</td><td>1.1x-1.2x</td><td>{'\u30CD\u30A4\u30C6\u30A3\u30D6\u4EE5\u4E0A\u306E\u901F\u5EA6\u306B\u6163\u308C\u308B \u2192 \u5B9F\u969B\u306E\u4F1A\u8A71\u304C\u9045\u304F\u611F\u3058\u308B'}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="guide-card">
            <button
              className="guide-accordion-btn"
              onClick={() => setExpandedGuideSection(expandedGuideSection === 'levelup' ? null : 'levelup')}
            >
              <span>{'\u{1F4C8} \u30EC\u30D9\u30EB\u30A2\u30C3\u30D7\u306E\u57FA\u6E96'}</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'levelup' ? '\u25B2' : '\u25BC'}</span>
            </button>
            {expandedGuideSection === 'levelup' && (
              <div className="guide-accordion-content">
                <div className="guide-level-cards">
                  <div className="guide-level-card">
                    <div className="guide-level-badge current">{'\u73FE\u5728'}</div>
                    <div className="guide-level-title">Phase 1: {'\u57FA\u790E\u56FA\u3081'}</div>
                    <div className="guide-level-desc">
                      <strong>Versant 35-50 {'\u2192'} 50+</strong><br />
                      {'\u30FB\u540C\u3058\u30C6\u30AD\u30B9\u30C8\u30921\u9031\u9593\u7E70\u308A\u8FD4\u3059'}<br />
                      {'\u30FB\u901F\u5EA6\u306F0.8x \u2192 1.0x'}<br />
                      {'\u30FB\u5230\u9054\u306E\u76EE\u5B89: \u30B7\u30E3\u30C9\u30FC\u30A4\u30F3\u30B0\u30679\u5272\u518D\u73FE\u3067\u304D\u308B'}
                    </div>
                  </div>
                  <div className="guide-level-card">
                    <div className="guide-level-badge next">{'\u6B21\u306E\u76EE\u6A19'}</div>
                    <div className="guide-level-title">Phase 2: {'\u6D41\u66A2\u6027\u5411\u4E0A'}</div>
                    <div className="guide-level-desc">
                      <strong>Versant 50 {'\u2192'} 55+</strong><br />
                      {'\u30FB1\u3064\u306E\u30C6\u30AD\u30B9\u30C8\u30923\u65E5\u3067\u5207\u308A\u66FF\u3048\u308B'}<br />
                      {'\u30FB\u901F\u5EA6\u306F1.0x \u2192 1.2x'}<br />
                      {'\u30FB\u5230\u9054\u306E\u76EE\u5B89: \u521D\u898B\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u30825\u56DE\u76EE\u3067\u30B9\u30E0\u30FC\u30BA'}
                    </div>
                  </div>
                  <div className="guide-level-card">
                    <div className="guide-level-badge future">{'\u6700\u7D42\u76EE\u6A19'}</div>
                    <div className="guide-level-title">Phase 3: {'\u81EA\u52D5\u5316'}</div>
                    <div className="guide-level-desc">
                      <strong>Versant 55+ / Speaking 160+</strong><br />
                      {'\u30FB\u6BCE\u65E5\u9055\u3046\u30C6\u30AD\u30B9\u30C8\u3067\u7DF4\u7FD2'}<br />
                      {'\u30FB\u901F\u5EA6\u306F1.0x\u4EE5\u4E0A'}<br />
                      {'\u30FB\u5230\u9054\u306E\u76EE\u5B89: \u81EA\u5206\u306E\u8A00\u8449\u3067\u5185\u5BB9\u3092\u8A00\u3044\u63DB\u3048\u3089\u308C\u308B'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="guide-card">
            <button
              className="guide-accordion-btn"
              onClick={() => setExpandedGuideSection(expandedGuideSection === 'tips' ? null : 'tips')}
            >
              <span>{'\u{1F48E} \u52B9\u679C\u3092\u6700\u5927\u5316\u3059\u308B\u30B3\u30C4'}</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'tips' ? '\u25B2' : '\u25BC'}</span>
            </button>
            {expandedGuideSection === 'tips' && (
              <div className="guide-accordion-content">
                <div className="guide-tips-grid">
                  <div className="guide-tip">
                    <div className="guide-tip-icon">{'\u{1F550}'}</div>
                    <div className="guide-tip-title">{'\u6BCE\u65E5\u540C\u3058\u6642\u9593\u306B\u3084\u308B'}</div>
                    <div className="guide-tip-text">{'\u671D\u306E\u901A\u52E4\u524D\u3084\u5BDD\u308B\u524D\u306A\u3069\u3001\u7FD2\u6163\u5316\u304C\u6700\u91CD\u8981\u30021\u65E530\u5206\u30922\u30F6\u6708\u7D9A\u3051\u308B\u3068\u5287\u7684\u306B\u5909\u308F\u308A\u307E\u3059\u3002'}</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">{'\u{1F399}\uFE0F'}</div>
                    <div className="guide-tip-title">{'\u5FC5\u305A\u58F0\u306B\u51FA\u3059'}</div>
                    <div className="guide-tip-text">{'\u9ED9\u8AAD\u3084\u5FC3\u306E\u4E2D\u3067\u8AAD\u3080\u306E\u306F\u52B9\u679C\u304C\u8584\u3044\u3002\u5B9F\u969B\u306B\u53E3\u3092\u52D5\u304B\u3057\u3001\u58F0\u3092\u51FA\u3059\u3053\u3068\u304C\u300C\u767A\u4FE1\u56DE\u8DEF\u300D\u3092\u4F5C\u308A\u307E\u3059\u3002'}</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">{'\u{1F4F1}'}</div>
                    <div className="guide-tip-title">{'\u9332\u97F3\u3057\u3066\u805E\u304D\u6BD4\u3079'}</div>
                    <div className="guide-tip-text">{'\u81EA\u5206\u306E\u97F3\u8AAD\u3092\u30B9\u30DE\u30DB\u3067\u9332\u97F3\u3057\u3001\u304A\u624B\u672C\u3068\u6BD4\u8F03\u3002\u30AE\u30E3\u30C3\u30D7\u3092\u610F\u8B58\u3059\u308B\u3068\u30D4\u30F3\u30DD\u30A4\u30F3\u30C8\u3067\u6539\u5584\u3067\u304D\u307E\u3059\u3002'}</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">{'\u{1F9E0}'}</div>
                    <div className="guide-tip-title">{'\u610F\u5473\u3092\u6620\u50CF\u5316\u3059\u308B'}</div>
                    <div className="guide-tip-text">{'\u82F1\u6587\u306E\u5185\u5BB9\u3092\u982D\u306E\u4E2D\u3067\u6620\u50CF\u3068\u3057\u3066\u30A4\u30E1\u30FC\u30B8\u3057\u306A\u304C\u3089\u8AAD\u3080\u3002\u300C\u65E5\u672C\u8A9E\u306B\u8A33\u3059\u300D\u306E\u3067\u306F\u306A\u304F\u300C\u5834\u9762\u3092\u601D\u3044\u6D6E\u304B\u3079\u308B\u300D\u3002'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
        </aside>

        <main className="app-main-content">
      {/* API Key Setup Modal */}
      {showApiSetup && (
        <div className="modal-overlay" onClick={() => apiKey && setShowApiSetup(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{'\u{1F511} Gemini API \u8A2D\u5B9A'}</h2>
              {apiKey && (
                <button className="modal-close" onClick={() => setShowApiSetup(false)}>{'\u2715'}</button>
              )}
            </div>
            <p className="modal-description">
              Gemini API{'\u306E\u30AD\u30FC\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u81EA\u7136\u3067\u9AD8\u54C1\u8CEA\u306A\u82F1\u8A9E\u97F3\u58F0\u3092\u751F\u6210\u3057\u307E\u3059\u3002'}
            </p>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="modal-link">
              {'\u{1F517} Google AI Studio \u3067API\u30AD\u30FC\u3092\u53D6\u5F97\u3059\u308B \u2192'}
            </a>
            <div className="modal-input-group">
              <input
                type="password"
                className="modal-input"
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
              />
              <button className="modal-save-btn" onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()}>
                {'\u4FDD\u5B58\u3059\u308B'}
              </button>
            </div>
            {apiKey && (
              <div className="modal-current-key">
                <span className="modal-current-key-label">{'\u73FE\u5728\u306E\u30AD\u30FC:'}</span>
                <span className="modal-current-key-value">
                  {apiKey.substring(0, 6)}...{apiKey.substring(apiKey.length - 4)}
                </span>
                <button className="modal-clear-btn" onClick={handleClearApiKey}>
                  {'\u524A\u9664'}
                </button>
              </div>
            )}
            <p className="modal-note">
              {'\u{1F4A1} API\u30AD\u30FC\u306F\u30D6\u30E9\u30A6\u30B6\u306ElocalStorage\u306B\u306E\u307F\u4FDD\u5B58\u3055\u308C\u3001\u5916\u90E8\u306B\u306F\u9001\u4FE1\u3055\u308C\u307E\u305B\u3093\u3002'}
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMsg && (
        <div className="error-banner">
          <span className="error-icon">{'\u26A0\uFE0F'}</span>
          <span>{errorMsg}</span>
          <button className="error-close" onClick={() => setErrorMsg('')}>{'\u2715'}</button>
        </div>
      )}

      {/* Master Badge Animation Overlay */}
      {masterBadgeAnim && (
        <div className="master-badge-overlay">
          <div className="master-badge-content">
            <div className="master-badge-icon">{'\u{1F3C5}'}</div>
            <div className="master-badge-text">{'\u30DE\u30B9\u30BF\u30FC\u9054\u6210\uFF01'}</div>
            <div className="master-badge-stars">{'\u2605\u2605\u2605\u2605\u2605'}</div>
          </div>
        </div>
      )}

      {/* Sample Texts with Category Filter */}
      <section className="sample-texts-section">
        <div className="section-label">
          <span className="icon">{'\u{1F4DA}'}</span>
          {'\u30B5\u30F3\u30D7\u30EB\u30C6\u30AD\u30B9\u30C8\uFF08TOEIC Part 4 \u30EC\u30D9\u30EB\uFF09'}
        </div>
        <div className="category-filter">
          <select
            className="category-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>
                {cat === 'All' ? '\u3059\u3079\u3066' : cat}
              </option>
            ))}
          </select>
          <span className="category-count">{filteredTexts.length} {'\u30C6\u30AD\u30B9\u30C8'}</span>
        </div>
        <div className="sample-texts-grid">
          {filteredTexts.map(sample => {
            const level = getMasteryLevel(sample.id);
            return (
              <div
                key={sample.id}
                className={`sample-text-card ${selectedTextId === sample.id ? 'selected' : ''}`}
                onClick={() => handleSampleSelect(sample)}
              >
                <div className="sample-text-card-header">
                  <div className="sample-text-card-title">{sample.title}</div>
                  {level > 0 && (
                    <div className={`mastery-stars level-${level}`}>
                      {getMasteryStars(level)}
                      {level === 5 && <span className="master-badge-inline">{'\u{1F3C5}'}</span>}
                    </div>
                  )}
                </div>
                <div className="sample-text-card-preview">
                  {sample.text.substring(0, 80)}...
                </div>
                <div className="sample-text-card-meta">
                  {sample.category} {'\u00B7'} {sample.wordCount} words
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Text Input */}
      <section className="text-input-section">
        <div className="section-label">
          <span className="icon">{'\u270F\uFE0F'}</span>
          {'\u82F1\u6587\u30C6\u30AD\u30B9\u30C8'}
        </div>
        <div className="text-area-wrapper">
          <textarea
            className="text-area"
            value={text}
            onChange={(e) => { setText(e.target.value); setSelectedTextId(null); }}
            placeholder={'\u3053\u3053\u306B\u82F1\u6587\u3092\u5165\u529B\u3059\u308B\u304B\u3001\u4E0A\u306E\u30B5\u30F3\u30D7\u30EB\u30C6\u30AD\u30B9\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044...\n\n\u6700\u9069\u306A\u9577\u3055: 120\u301C150\u8A9E\uFF08TOEIC Part 4 \u30EC\u30D9\u30EB\uFF09'}
          />
        </div>
        <div className="word-count-bar">
          <span className={`word-count ${getWordCountStatus()}`}>
            {wordCount > 0 ? `${wordCount} \u8A9E` : '0 \u8A9E'}
            {wordCount > 0 && wordCount < 120 && ` (\u3042\u3068 ${120 - wordCount} \u8A9E\u3067\u6700\u9069)`}
            {getWordCountStatus() === 'optimal' && ' \u2713 \u6700\u9069\u306A\u9577\u3055\u3067\u3059'}
            {getWordCountStatus() === 'warning' && ' \u26A0 \u5C11\u3057\u9577\u3081\u3067\u3059'}
          </span>
          <div className="word-count-progress">
            <div
              className={`word-count-progress-bar ${getWordCountStatus()}`}
              style={{ width: `${Math.min((wordCount / 150) * 100, 100)}%` }}
            />
          </div>
        </div>
      </section>

      {/* Playback Controls */}
      <section className="playback-section">
        <div className="section-label">
          <span className="icon">{'\u{1F508}'}</span>
          Gemini {'\u97F3\u58F0\u518D\u751F'}
        </div>
        <div className="playback-controls">
          <button
            className={`play-btn play-btn-primary ${isPlaying ? 'playing' : ''} ${isLoading ? 'loading' : ''}`}
            onClick={handlePlayAll}
            disabled={!text.trim() || isLoading}
          >
            {isLoading ? (
              <><span className="spinner" />{'\u751F\u6210\u4E2D...'}</>
            ) : isPlaying ? (
              '\u23F9 \u505C\u6B62\u3059\u308B'
            ) : (
              '\u25B6 \u5168\u6587\u3092\u518D\u751F'
            )}
          </button>
          <button
            className="play-btn play-btn-secondary"
            onClick={handlePlaySentence}
            disabled={!sentences.length || isPlaying || isLoading}
          >
            {'\u{1F4DD} \u73FE\u5728\u306E\u6587\u3092\u518D\u751F'}
          </button>
        </div>

        <div className={`waveform-container ${isPlaying ? 'visible' : ''}`}>
          {[...Array(10)].map((_, i) => (
            <div key={i} className="waveform-bar" />
          ))}
        </div>

        {isLoading && (
          <div className="loading-text">
            {'\u{1F399}\uFE0F Gemini \u3067\u9AD8\u54C1\u8CEA\u97F3\u58F0\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059...'}
          </div>
        )}

        <div className="speed-control">
          <span className="speed-label">{'\u{1F422}'}</span>
          <input
            type="range"
            className="speed-slider"
            min="0.5"
            max="1.5"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
          />
          <span className="speed-label">{'\u{1F407}'}</span>
          <span className="speed-value">{speed.toFixed(1)}x</span>
        </div>

        <div className="voice-model-row">
          <div className="voice-select-wrapper">
            <span className="speed-label">{'\u{1F5E3}\uFE0F \u97F3\u58F0:'}</span>
            <select
              className="voice-select"
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
            >
              {voices.map((voice) => (
                <option key={voice.voice_id} value={voice.voice_id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
          <div className="voice-select-wrapper">
            <span className="speed-label">{'\u{1F916} \u30E2\u30C7\u30EB:'}</span>
            <select
              className="voice-select"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
            </select>
          </div>
        </div>
      </section>

      {/* Practice Modes */}
      <section className="practice-section">
        <div className="section-label">
          <span className="icon">{'\u{1F3CB}\uFE0F'}</span>
          {'\u7DF4\u7FD2\u30E2\u30FC\u30C9'}
        </div>

        <div className="mode-tabs">
          {Object.values(PRACTICE_MODES).map(mode => (
            <div
              key={mode.key}
              className={`mode-tab ${mode.key === 'readLookup' ? 'read-lookup' : mode.key} ${activeMode === mode.key ? 'active' : ''}`}
              onClick={() => {
                setActiveMode(mode.key);
                if (mode.key === 'shadowing') setTextVisible(false);
                else if (mode.key === 'readLookup') setTextVisible(true);
                else setTextVisible(true);
              }}
            >
              <div className="mode-tab-icon">{mode.icon}</div>
              <div className="mode-tab-title">{mode.title}</div>
              <div className="mode-tab-subtitle">{mode.subtitle}</div>
            </div>
          ))}
        </div>

        {/* Practice Panel */}
        <div className="practice-panel">
          <div className="practice-panel-header">
            <h3 className="practice-panel-title">
              {currentMode.icon} {currentMode.title}
            </h3>
            <div className="practice-counter">
              {practiceCount[activeMode]} / {currentMode.target} {'\u56DE'}
            </div>
          </div>

          <div className={`practice-panel-description ${activeMode === 'readLookup' ? 'read-lookup-desc' : activeMode === 'shadowing' ? 'shadowing-desc' : 'overlapping-desc'}`}>
            {currentMode.description}
          </div>

          {text.trim() ? (
            <>
              {activeMode === 'readLookup' ? (
                <div className="sentence-display">
                  <div className={`sentence-text ${!textVisible ? 'hidden' : ''}`}>
                    {sentences[currentSentenceIndex] || ''}
                  </div>
                  <div className="sentence-nav">
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(0)}
                      disabled={currentSentenceIndex === 0}
                      title={'\u4E00\u6587\u76EE\u306B\u623B\u308B'}
                    >
                      {'\u23EA 1\u6587\u76EE'}
                    </button>
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(prev => Math.max(0, prev - 1))}
                      disabled={currentSentenceIndex === 0}
                    >
                      {'\u2190 \u524D\u306E\u6587'}
                    </button>
                    <span className="sentence-counter-text">
                      {currentSentenceIndex + 1} / {sentences.length}
                    </span>
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(prev => Math.min(sentences.length - 1, prev + 1))}
                      disabled={currentSentenceIndex >= sentences.length - 1}
                    >
                      {'\u6B21\u306E\u6587 \u2192'}
                    </button>
                  </div>
                  <button
                    className="toggle-visibility-btn"
                    onClick={() => setTextVisible(prev => !prev)}
                  >
                    {textVisible ? '\u{1F440} \u30C6\u30AD\u30B9\u30C8\u3092\u96A0\u3059' : '\u{1F4D6} \u30C6\u30AD\u30B9\u30C8\u3092\u8868\u793A'}
                  </button>
                </div>
              ) : (
                <div className={`practice-text-display ${!textVisible ? 'hidden-text' : ''}`}>
                  {text}
                </div>
              )}

              {activeMode === 'shadowing' && (
                <button
                  className="toggle-visibility-btn"
                  onClick={() => setTextVisible(prev => !prev)}
                  style={{ marginBottom: '1rem' }}
                >
                  {textVisible ? '\u{1F440} \u30C6\u30AD\u30B9\u30C8\u3092\u96A0\u3059\uFF08\u63A8\u5968\uFF09' : '\u{1F4D6} \u30C6\u30AD\u30B9\u30C8\u3092\u8868\u793A'}
                </button>
              )}

              {/* Practice Actions */}
              <div className="practice-actions">
                <button
                  className={`practice-btn practice-btn-start ${isLoading ? 'loading' : ''}`}
                  onClick={() => {
                    if (isPlaying) {
                      stopSpeaking();
                    } else {
                      if (activeMode === 'readLookup') {
                        handlePlaySentence();
                      } else {
                        speak(text);
                      }
                    }
                  }}
                  disabled={!text.trim() || isLoading}
                >
                  {isLoading ? (
                    <><span className="spinner" />{'\u751F\u6210\u4E2D...'}</>
                  ) : isPlaying ? '\u23F9 \u505C\u6B62' : '\u25B6 \u97F3\u58F0\u3092\u518D\u751F'}
                </button>
                <button
                  className="practice-btn practice-btn-count"
                  onClick={() => handleCountUp(activeMode)}
                >
                  {'\u2705 1\u56DE\u5B8C\u4E86 (+1)'}
                </button>
                <button
                  className="practice-btn practice-btn-reset"
                  onClick={() => handleCountReset(activeMode)}
                >
                  {'\u{1F504} \u30EA\u30BB\u30C3\u30C8'}
                </button>
                {/* Speed Challenge Button */}
                {selectedTextId && (
                  <button
                    className={`practice-btn practice-btn-speed-challenge ${newRecordAnim ? 'new-record' : ''}`}
                    onClick={handleSpeedChallenge}
                  >
                    {newRecordAnim ? '\u{1F389} \u65B0\u8A18\u9332\uFF01' : '\u{1F3C6} \u901F\u5EA6\u30C1\u30E3\u30EC\u30F3\u30B8'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="practice-text-display" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              {'\u4E0A\u306E\u30C6\u30AD\u30B9\u30C8\u30A8\u30EA\u30A2\u306B\u82F1\u6587\u3092\u5165\u529B\u3059\u308B\u304B\u3001\u30B5\u30F3\u30D7\u30EB\u30C6\u30AD\u30B9\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044'}
            </div>
          )}
        </div>
      </section>

      {/* Progress */}
      <section className="progress-section">
        <div className="section-label">
          <span className="icon">{'\u{1F4CA}'}</span>
          {'\u4ECA\u65E5\u306E\u9032\u6357'}
        </div>
        <div className="progress-grid">
          {Object.values(PRACTICE_MODES).map(mode => (
            <div key={mode.key} className="progress-card">
              <div className="progress-card-icon">{mode.icon}</div>
              <div className="progress-card-label">{mode.title}</div>
              <div className={`progress-card-value ${mode.color}`}>
                {practiceCount[mode.key]}
              </div>
              <div className="progress-card-target">
                {'\u76EE\u6A19: '}{mode.target} {'\u56DE'}
              </div>
              <div className="progress-bar-track">
                <div
                  className={`progress-bar-fill ${mode.color}`}
                  style={{ width: `${getProgressPercent(mode.key)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Speed Records for current text */}
        {selectedTextId && (() => {
          const records = getSpeedRecordForCurrentText();
          if (!records || records.length === 0) return null;
          return (
            <div className="speed-records-section">
              <div className="section-label" style={{ marginTop: '1.5rem' }}>
                <span className="icon">{'\u{1F3C6}'}</span>
                {'\u901F\u5EA6\u30C1\u30E3\u30EC\u30F3\u30B8\u8A18\u9332'}
              </div>
              <div className="speed-records-grid">
                {records.map(rec => (
                  <div key={rec.mode} className="speed-record-card">
                    <div className="speed-record-mode">{PRACTICE_MODES[rec.mode]?.icon} {PRACTICE_MODES[rec.mode]?.title}</div>
                    <div className="speed-record-value">{rec.maxSpeed.toFixed(1)}x</div>
                    <div className="speed-record-date">{rec.achievedAt}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </section>

      {/* Calendar Section */}
      <section className="calendar-section">
        <div className="section-label">
          <span className="icon">{'\u{1F4C5}'}</span>
          {'\u7DF4\u7FD2\u30AB\u30EC\u30F3\u30C0\u30FC'}
        </div>
        <div className="calendar-card">
          <div className="calendar-nav">
            <button className="calendar-nav-btn" onClick={() => setCalendarMonth(prev => {
              const m = prev.month - 1;
              return m < 0 ? { year: prev.year - 1, month: 11 } : { ...prev, month: m };
            })}>{'\u25C0'}</button>
            <span className="calendar-month-label">{calendarMonthName()}</span>
            <button className="calendar-nav-btn" onClick={() => setCalendarMonth(prev => {
              const m = prev.month + 1;
              return m > 11 ? { year: prev.year + 1, month: 0 } : { ...prev, month: m };
            })}>{'\u25B6'}</button>
          </div>
          <div className="calendar-grid">
            {['\u65E5', '\u6708', '\u706B', '\u6C34', '\u6728', '\u91D1', '\u571F'].map(d => (
              <div key={d} className="calendar-header-cell">{d}</div>
            ))}
            {getCalendarDays().map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="calendar-cell empty" />;
              const dateStr = getDateStr(day);
              const intensity = getPracticeIntensity(dateStr);
              const isToday = dateStr === getTodayStr();
              return (
                <div
                  key={day}
                  className={`calendar-cell ${intensity > 0 ? `intensity-${intensity}` : ''} ${isToday ? 'today' : ''} ${calendarPopover === dateStr ? 'popover-active' : ''}`}
                  onClick={() => setCalendarPopover(calendarPopover === dateStr ? null : dateStr)}
                >
                  <span className="calendar-day-num">{day}</span>
                  {intensity > 0 && <span className="calendar-dot" />}
                </div>
              );
            })}
          </div>
          {/* Popover */}
          {calendarPopover && practiceLog[calendarPopover] && (
            <div className="calendar-popover">
              <div className="calendar-popover-header">
                <span>{calendarPopover}</span>
                <button className="calendar-popover-close" onClick={() => setCalendarPopover(null)}>{'\u2715'}</button>
              </div>
              <div className="calendar-popover-body">
                <div className="calendar-popover-stat">
                  <span>{'\u7DF4\u7FD2\u6642\u9593'}</span>
                  <strong>{practiceLog[calendarPopover].totalMinutes || 0}{'\u5206'}</strong>
                </div>
                <div className="calendar-popover-stat">
                  <span>{'\u30BB\u30C3\u30B7\u30E7\u30F3\u6570'}</span>
                  <strong>{practiceLog[calendarPopover].sessions || 0}{'\u56DE'}</strong>
                </div>
                {practiceLog[calendarPopover].modes && (
                  <div className="calendar-popover-modes">
                    {Object.entries(practiceLog[calendarPopover].modes).map(([mode, count]) => (
                      count > 0 && (
                        <div key={mode} className="calendar-popover-mode">
                          <span>{PRACTICE_MODES[mode]?.icon} {PRACTICE_MODES[mode]?.title}</span>
                          <span>{count}{'\u56DE'}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Growth Chart Section */}
      <section className="growth-chart-section">
        <div className="section-label">
          <span className="icon">{'\u{1F4C8}'}</span>
          {'\u6210\u9577\u30B0\u30E9\u30D5'}
        </div>
        <div className="growth-chart-card">
          <div className="bar-chart">
            {weeklyData.map((week, i) => (
              <div key={i} className="bar-chart-column">
                <div className="bar-chart-value">{week.minutes}{'\u5206'}</div>
                <div className="bar-chart-bar-wrapper">
                  <div
                    className="bar-chart-bar"
                    style={{ height: `${maxWeekMinutes > 0 ? (week.minutes / maxWeekMinutes) * 100 : 0}%` }}
                  />
                </div>
                <div className="bar-chart-label">{week.label}</div>
              </div>
            ))}
          </div>
          <div className="growth-comment">{growthComment}</div>
        </div>
      </section>

        </main>
      </div>
    </div>
  )
}

export default App
