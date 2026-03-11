import { useState, useEffect, useRef, useCallback } from 'react'
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
  }
];

// --- Practice Mode Config ---
const PRACTICE_MODES = {
  overlapping: {
    key: 'overlapping',
    icon: '🔊',
    title: 'オーバーラッピング',
    subtitle: '音声に重ねて読む',
    target: 10,
    color: 'blue',
    description: 'お手本の音声に0.1秒も遅れずに、ピッタリ重ねて読みます。音声を再生しながら、同時に声に出して読みましょう。ビジネス英語のリズムを脳に叩き込むトレーニングです。'
  },
  readLookup: {
    key: 'readLookup',
    icon: '👀',
    title: 'リード＆ルックアップ',
    subtitle: '読んで顔を上げて言う',
    target: 5,
    color: 'purple',
    description: '一文を読み、顔を上げて（テキストを見ずに）宙に向かってその一文を言います。文章構築力と保持力を鍛えるトレーニングです。テキストの表示/非表示を切り替えて練習しましょう。'
  },
  shadowing: {
    key: 'shadowing',
    icon: '🎧',
    title: 'シャドーイング',
    subtitle: '音声を追いかけて発音',
    target: 5,
    color: 'cyan',
    description: 'テキストを見ずに、音声だけを頼りに影のように追いかけて発音します。テキストは非表示の状態で、音声を再生して後を追いかけましょう。「意味」に集中するコンテンツ・シャドーイングです。'
  }
};

function App() {
  // API Key state
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Text state
  const [text, setText] = useState('');
  const [wordCount, setWordCount] = useState(0);

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

  // Check API key on mount
  useEffect(() => {
    if (!apiKey) {
      setShowApiSetup(true);
    }
  }, []);

  // Voices are prebuilt for Gemini, so we don't need to fetch them from an endpoint.

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
      setErrorMsg('APIキーを設定してください');
      return;
    }
    if (!textToSpeak.trim()) return;

    // Stop current audio
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
        // 1. Check IndexedDB cache explicitly to reuse previously created audio
        const cachedBlob = await getCachedAudio(cacheKey);
        
        if (cachedBlob) {
          audioUrl = URL.createObjectURL(cachedBlob);
          audioCacheRef.current[cacheKey] = audioUrl;
          console.log("Loaded audio from IndexedDB cache:", cacheKey.substring(0, 50) + "...");
        } else {
          // 2. Not in cache, fetch from API
          const response = await fetch(
            `${GEMINI_API_URL}/${modelId}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: textToSpeak
                      }
                    ]
                  }
                ],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: selectedVoiceId
                      }
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
          console.log("⚡️ Gemini API Response Data:", data);
          const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

          if (!audioPart || !audioPart.inlineData) {
            const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
            console.error("No audio part found. Returned text:", textPart?.text);
            throw new Error(`音声データの生成に失敗しました（レスポンスに音声が含まれていません: ${textPart ? 'テキストが返却されました' : '不明なレスポンス形式'}）。開発者ツールのConsoleを確認してください。`);
          }

          const base64Audio = audioPart.inlineData.data;

          // Convert base64 to Blob
          const byteCharacters = atob(base64Audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          
          let audioData = byteArray;
          // Check if data is already a WAV file (starts with 'RIFF')
          const isWav = byteArray.length > 4 && 
                        byteArray[0] === 82 && 
                        byteArray[1] === 73 && 
                        byteArray[2] === 70 && 
                        byteArray[3] === 70;
                        
          if (!isWav) {
            // Gemini API returns raw 16-bit 24kHz PCM. We must add a WAV header for browsers to play it.
            audioData = addWavHeader(byteArray, 24000);
          }

          const audioBlob = new Blob([audioData], { type: 'audio/wav' });

          // 3. Save to IndexedDB for future use (survives page reloads)
          await setCachedAudio(cacheKey, audioBlob);

          audioUrl = URL.createObjectURL(audioBlob);
          audioCacheRef.current[cacheKey] = audioUrl;
          console.log("Saved new audio to IndexedDB cache:", cacheKey.substring(0, 50) + "...");
        }
      }

      audioBlobUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);
      audio.playbackRate = speed;
      audioRef.current = audio;

      audio.onplay = () => {
        setIsPlaying(true);
        setIsLoading(false);
      };
      audio.onended = () => {
        setIsPlaying(false);
      };
      audio.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        setErrorMsg('音声の再生に失敗しました');
      };

      await audio.play();
    } catch (err) {
      setIsLoading(false);
      setIsPlaying(false);

      if (err.message.includes('API_KEY_INVALID') || err.message.includes('400')) {
        setErrorMsg('APIキーが無効です。正しいキーを設定してください。');
        setShowApiSetup(true);
      } else {
        setErrorMsg(`エラー: ${err.message}`);
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

  // Update playback rate when speed changes
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

  const handleSampleSelect = (sampleText) => {
    setText(sampleText);
    setPracticeCount({ overlapping: 0, readLookup: 0, shadowing: 0 });
  };

  const handleCountUp = (mode) => {
    setPracticeCount(prev => ({
      ...prev,
      [mode]: prev[mode] + 1
    }));
  };

  const handleCountReset = (mode) => {
    setPracticeCount(prev => ({
      ...prev,
      [mode]: 0
    }));
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

  const currentMode = PRACTICE_MODES[activeMode];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">🎙️</div>
        </div>
        <h1 className="app-title">SpeakFlow</h1>
        <p className="app-subtitle">
          英文音読トレーニングで、あなたの発音力を飛躍的に向上させる
        </p>
        {/* API Key Status Badge */}
        <div className="api-status-bar">
          {apiKey ? (
            <button className="api-badge api-badge-connected" onClick={() => setShowApiSetup(true)}>
              <span className="api-badge-dot connected" />
              Gemini API 接続済み
            </button>
          ) : (
            <button className="api-badge api-badge-disconnected" onClick={() => setShowApiSetup(true)}>
              <span className="api-badge-dot disconnected" />
              APIキー未設定
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
              <span className="guide-profile-icon">📋</span>
              <div>
                <div className="guide-profile-title">あなたのプロファイル</div>
                <div className="guide-profile-subtitle">現在のレベルに最適化されたトレーニング</div>
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
                <div className="guide-stat-detail">伸び代あり</div>
              </div>
              <div className="guide-stat-divider" />
              <div className="guide-stat">
                <div className="guide-stat-value rose">150</div>
                <div className="guide-stat-label">Speaking</div>
                <div className="guide-stat-detail">目標: 160+</div>
              </div>
            </div>
            <div className="guide-diagnosis">
              <span className="guide-diagnosis-icon">💡</span>
              <span>音は聞き取れるが、口が動きを覚えていない状態。「受信→発信」への回路切替が必要です。</span>
            </div>
          </div>
          <button className="guide-toggle-btn" onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? '📖 練習マニュアルを閉じる ▲' : '📖 練習マニュアルを開く ▼'}
          </button>
        </div>
      </section>

      {/* Detailed Guide */}
      {showGuide && (
        <section className="guide-detail-section">
          {/* Daily Menu */}
          <div className="guide-card">
            <h3 className="guide-card-title">⏱ 毎日の練習メニュー（約25〜30分）</h3>
            <p className="guide-card-intro">1つのテキスト（120〜150語）を使い、以下の順番で練習します。</p>

            <div className="guide-timeline">
              <div className="guide-timeline-item">
                <div className="guide-timeline-marker blue" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 1</div>
                  <div className="guide-timeline-title">テキストの内容理解（2分）</div>
                  <div className="guide-timeline-desc">
                    まずテキストを黙読し、意味を完全に理解します。知らない単語があれば調べておきましょう。<br />
                    <strong>ポイント:</strong> 意味がわからないまま音読しても効果は半減します。
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker blue" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 2</div>
                  <div className="guide-timeline-title">🔊 オーバーラッピング × 10回（10〜12分）</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">やり方</div>
                      <ol className="guide-steps-list">
                        <li>「▶ 音声を再生」ボタンを押す</li>
                        <li>テキストを見ながら、音声と<strong>ピッタリ同時に</strong>声を出す</li>
                        <li>音声の速度・リズム・イントネーションを完全にコピーする</li>
                        <li>1回終わったら「✅ 1回完了」をタップ</li>
                        <li>10回繰り返す</li>
                      </ol>
                    </div>
                    <div className="guide-point-box blue">
                      <strong>🎯 意識するポイント:</strong><br />
                      ・0.1秒も遅れずに音声と重なること<br />
                      ・最初の3回は0.8xで、慣れたら1.0xにスピードアップ<br />
                      ・リンキング（音の連結: "picked up" → "ピクタップ"）を意識
                    </div>
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker purple" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 3</div>
                  <div className="guide-timeline-title">👀 リード＆ルックアップ × 5回（8〜10分）</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">やり方</div>
                      <ol className="guide-steps-list">
                        <li>「リード＆ルックアップ」タブを選択</li>
                        <li>表示された一文を読む</li>
                        <li>「👀 テキストを隠す」ボタンを押す</li>
                        <li>顔を上げて、宙に向かってその文を暗唱する</li>
                        <li>「次の文 →」で次へ進む</li>
                        <li>全文を通して1回。それを5回繰り返す</li>
                      </ol>
                    </div>
                    <div className="guide-point-box purple">
                      <strong>🎯 意識するポイント:</strong><br />
                      ・一語一語ではなく、<strong>チャンク（意味のかたまり）</strong>で記憶する<br />
                      ・完璧でなくてOK。8割言えたら次の文へ<br />
                      ・Versant の「文章構築力」と「保持力」が鍛えられる
                    </div>
                  </div>
                </div>
              </div>

              <div className="guide-timeline-item">
                <div className="guide-timeline-marker cyan" />
                <div className="guide-timeline-content">
                  <div className="guide-timeline-step">Step 4</div>
                  <div className="guide-timeline-title">🎧 コンテンツ・シャドーイング × 5回（5〜8分）</div>
                  <div className="guide-timeline-desc">
                    <div className="guide-how-to">
                      <div className="guide-how-to-title">やり方</div>
                      <ol className="guide-steps-list">
                        <li>「シャドーイング」タブを選択（テキスト自動非表示）</li>
                        <li>「▶ 音声を再生」を押す</li>
                        <li>テキストを見ずに、音声の0.5〜1秒後を追いかけて発音</li>
                        <li>「意味」を頭の中でイメージしながら行う</li>
                        <li>5回繰り返す</li>
                      </ol>
                    </div>
                    <div className="guide-point-box cyan">
                      <strong>🎯 意識するポイント:</strong><br />
                      ・音の「モノマネ」ではなく、<strong>意味の理解</strong>に集中する<br />
                      ・最初はつまってもOK。回数を重ねて滑らかに<br />
                      ・「体が勝手に英語を発する」感覚がゴール
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Collapsible sections */}
          <div className="guide-card">
            <button
              className="guide-accordion-btn"
              onClick={() => setExpandedGuideSection(expandedGuideSection === 'speed' ? null : 'speed')}
            >
              <span>🚀 スピードの上げ方ガイド</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'speed' ? '▲' : '▼'}</span>
            </button>
            {expandedGuideSection === 'speed' && (
              <div className="guide-accordion-content">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th>期間</th>
                      <th>推奨スピード</th>
                      <th>目標</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Week 1-2</td>
                      <td>0.8x</td>
                      <td>音の連結・脱落を正確に聞き取る</td>
                    </tr>
                    <tr>
                      <td>Week 3-4</td>
                      <td>0.9x</td>
                      <td>オーバーラッピングで遅れずに付いていける</td>
                    </tr>
                    <tr>
                      <td>Week 5-6</td>
                      <td>1.0x（ネイティブ速度）</td>
                      <td>シャドーイングで8割以上再現できる</td>
                    </tr>
                    <tr>
                      <td>Week 7+</td>
                      <td>1.1x-1.2x</td>
                      <td>ネイティブ以上の速度に慣れる → 実際の会話が遅く感じる</td>
                    </tr>
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
              <span>📈 レベルアップの基準</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'levelup' ? '▲' : '▼'}</span>
            </button>
            {expandedGuideSection === 'levelup' && (
              <div className="guide-accordion-content">
                <div className="guide-level-cards">
                  <div className="guide-level-card">
                    <div className="guide-level-badge current">現在</div>
                    <div className="guide-level-title">Phase 1: 基礎固め</div>
                    <div className="guide-level-desc">
                      <strong>Versant 35-50 → 50+</strong><br />
                      ・同じテキストを1週間繰り返す<br />
                      ・速度は0.8x → 1.0x<br />
                      ・到達の目安: シャドーイングで9割再現できる
                    </div>
                  </div>
                  <div className="guide-level-card">
                    <div className="guide-level-badge next">次の目標</div>
                    <div className="guide-level-title">Phase 2: 流暢性向上</div>
                    <div className="guide-level-desc">
                      <strong>Versant 50 → 55+</strong><br />
                      ・1つのテキストを3日で切り替える<br />
                      ・速度は1.0x → 1.2x<br />
                      ・到達の目安: 初見のテキストでも5回目でスムーズ
                    </div>
                  </div>
                  <div className="guide-level-card">
                    <div className="guide-level-badge future">最終目標</div>
                    <div className="guide-level-title">Phase 3: 自動化</div>
                    <div className="guide-level-desc">
                      <strong>Versant 55+ / Speaking 160+</strong><br />
                      ・毎日違うテキストで練習<br />
                      ・速度は1.0x以上<br />
                      ・到達の目安: 自分の言葉で内容を言い換えられる
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
              <span>💎 効果を最大化するコツ</span>
              <span className="guide-accordion-icon">{expandedGuideSection === 'tips' ? '▲' : '▼'}</span>
            </button>
            {expandedGuideSection === 'tips' && (
              <div className="guide-accordion-content">
                <div className="guide-tips-grid">
                  <div className="guide-tip">
                    <div className="guide-tip-icon">🕐</div>
                    <div className="guide-tip-title">毎日同じ時間にやる</div>
                    <div className="guide-tip-text">朝の通勤前や寝る前など、習慣化が最重要。1日30分を2ヶ月続けると劇的に変わります。</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">🎙️</div>
                    <div className="guide-tip-title">必ず声に出す</div>
                    <div className="guide-tip-text">黙読や心の中で読むのは効果が薄い。実際に口を動かし、声を出すことが「発信回路」を作ります。</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">📱</div>
                    <div className="guide-tip-title">録音して聞き比べ</div>
                    <div className="guide-tip-text">自分の音読をスマホで録音し、お手本と比較。ギャップを意識するとピンポイントで改善できます。</div>
                  </div>
                  <div className="guide-tip">
                    <div className="guide-tip-icon">🧠</div>
                    <div className="guide-tip-title">意味を映像化する</div>
                    <div className="guide-tip-text">英文の内容を頭の中で映像としてイメージしながら読む。「日本語に訳す」のではなく「場面を思い浮かべる」。</div>
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
              <h2 className="modal-title">🔑 Gemini API 設定</h2>
              {apiKey && (
                <button className="modal-close" onClick={() => setShowApiSetup(false)}>✕</button>
              )}
            </div>
            <p className="modal-description">
              Gemini APIのキーを入力してください。自然で高品質な英語音声を生成します。
            </p>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="modal-link"
            >
              🔗 Google AI Studio でAPIキーを取得する →
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
                保存する
              </button>
            </div>
            {apiKey && (
              <div className="modal-current-key">
                <span className="modal-current-key-label">現在のキー:</span>
                <span className="modal-current-key-value">
                  {apiKey.substring(0, 6)}...{apiKey.substring(apiKey.length - 4)}
                </span>
                <button className="modal-clear-btn" onClick={handleClearApiKey}>
                  削除
                </button>
              </div>
            )}
            <p className="modal-note">
              💡 APIキーはブラウザのlocalStorageにのみ保存され、外部には送信されません。
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMsg && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{errorMsg}</span>
          <button className="error-close" onClick={() => setErrorMsg('')}>✕</button>
        </div>
      )}

      {/* Sample Texts */}
      <section className="sample-texts-section">
        <div className="section-label">
          <span className="icon">📚</span>
          サンプルテキスト（TOEIC Part 4 レベル）
        </div>
        <div className="sample-texts-grid">
          {SAMPLE_TEXTS.map(sample => (
            <div
              key={sample.id}
              className="sample-text-card"
              onClick={() => handleSampleSelect(sample.text)}
            >
              <div className="sample-text-card-title">{sample.title}</div>
              <div className="sample-text-card-preview">
                {sample.text.substring(0, 80)}...
              </div>
              <div className="sample-text-card-meta">
                {sample.category} · {sample.wordCount} words
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Text Input */}
      <section className="text-input-section">
        <div className="section-label">
          <span className="icon">✏️</span>
          英文テキスト
        </div>
        <div className="text-area-wrapper">
          <textarea
            className="text-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ここに英文を入力するか、上のサンプルテキストを選択してください...&#10;&#10;最適な長さ: 120〜150語（TOEIC Part 4 レベル）"
          />
        </div>
        <div className="word-count-bar">
          <span className={`word-count ${getWordCountStatus()}`}>
            {wordCount > 0 ? `${wordCount} 語` : '0 語'}
            {wordCount > 0 && wordCount < 120 && ` (あと ${120 - wordCount} 語で最適)`}
            {getWordCountStatus() === 'optimal' && ' ✓ 最適な長さです'}
            {getWordCountStatus() === 'warning' && ' ⚠ 少し長めです'}
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
          <span className="icon">🔈</span>
          Gemini 音声再生
        </div>
        <div className="playback-controls">
          <button
            className={`play-btn play-btn-primary ${isPlaying ? 'playing' : ''} ${isLoading ? 'loading' : ''}`}
            onClick={handlePlayAll}
            disabled={!text.trim() || isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner" />
                生成中...
              </>
            ) : isPlaying ? (
              '⏹ 停止する'
            ) : (
              '▶ 全文を再生'
            )}
          </button>
          <button
            className="play-btn play-btn-secondary"
            onClick={handlePlaySentence}
            disabled={!sentences.length || isPlaying || isLoading}
          >
            📝 現在の文を再生
          </button>
        </div>

        {/* Waveform */}
        <div className={`waveform-container ${isPlaying ? 'visible' : ''}`}>
          {[...Array(10)].map((_, i) => (
            <div key={i} className="waveform-bar" />
          ))}
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="loading-text">
            🎙️ Gemini で高品質音声を生成しています...
          </div>
        )}

        {/* Speed Control */}
        <div className="speed-control">
          <span className="speed-label">🐢</span>
          <input
            type="range"
            className="speed-slider"
            min="0.5"
            max="1.5"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
          />
          <span className="speed-label">🐇</span>
          <span className="speed-value">{speed.toFixed(1)}x</span>
        </div>

        {/* Voice & Model Selection */}
        <div className="voice-model-row">
          <div className="voice-select-wrapper">
            <span className="speed-label">🗣️ 音声:</span>
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
            <span className="speed-label">🤖 モデル:</span>
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
          <span className="icon">🏋️</span>
          練習モード
        </div>

        {/* Mode Tabs */}
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
              {practiceCount[activeMode]} / {currentMode.target} 回
            </div>
          </div>

          <div className={`practice-panel-description ${activeMode === 'readLookup' ? 'read-lookup-desc' : activeMode === 'shadowing' ? 'shadowing-desc' : 'overlapping-desc'}`}>
            {currentMode.description}
          </div>

          {/* Text Display */}
          {text.trim() ? (
            <>
              {activeMode === 'readLookup' ? (
                /* Read & Look Up Mode - Sentence by sentence */
                <div className="sentence-display">
                  <div className={`sentence-text ${!textVisible ? 'hidden' : ''}`}>
                    {sentences[currentSentenceIndex] || ''}
                  </div>
                  <div className="sentence-nav">
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(0)}
                      disabled={currentSentenceIndex === 0}
                      title="1文目に戻る"
                    >
                      ⏪ 1文目
                    </button>
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(prev => Math.max(0, prev - 1))}
                      disabled={currentSentenceIndex === 0}
                    >
                      ← 前の文
                    </button>
                    <span className="sentence-counter-text">
                      {currentSentenceIndex + 1} / {sentences.length}
                    </span>
                    <button
                      className="sentence-nav-btn"
                      onClick={() => setCurrentSentenceIndex(prev => Math.min(sentences.length - 1, prev + 1))}
                      disabled={currentSentenceIndex >= sentences.length - 1}
                    >
                      次の文 →
                    </button>
                  </div>
                  <button
                    className="toggle-visibility-btn"
                    onClick={() => setTextVisible(prev => !prev)}
                  >
                    {textVisible ? '👀 テキストを隠す' : '📖 テキストを表示'}
                  </button>
                </div>
              ) : (
                /* Overlapping & Shadowing - Full text */
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
                  {textVisible ? '👀 テキストを隠す（推奨）' : '📖 テキストを表示'}
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
                    <>
                      <span className="spinner" />
                      生成中...
                    </>
                  ) : isPlaying ? '⏹ 停止' : '▶ 音声を再生'}
                </button>
                <button
                  className="practice-btn practice-btn-count"
                  onClick={() => handleCountUp(activeMode)}
                >
                  ✅ 1回完了 (+1)
                </button>
                <button
                  className="practice-btn practice-btn-reset"
                  onClick={() => handleCountReset(activeMode)}
                >
                  🔄 リセット
                </button>
              </div>
            </>
          ) : (
            <div className="practice-text-display" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              上のテキストエリアに英文を入力するか、サンプルテキストを選択してください
            </div>
          )}
        </div>
      </section>

      {/* Progress */}
      <section className="progress-section">
        <div className="section-label">
          <span className="icon">📊</span>
          今日の進捗
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
                目標: {mode.target} 回
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
      </section>
        </main>
      </div>
    </div>
  )
}

export default App
