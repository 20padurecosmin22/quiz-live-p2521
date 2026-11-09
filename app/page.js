'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { joinTopic, postTo, postReliable, topics, randomId, MODE } from '@/lib/room';
import { OPTIONS, Shape } from '@/lib/shapes';

const SAVE_KEY = 'quiz-live-player';

function Player() {
  const params = useSearchParams();
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [stage, setStage] = useState('join'); // join, connecting, waiting, intro, question, answered, reveal, scoreboard, podium, closed
  const [err, setErr] = useState('');
  const [me, setMe] = useState(null); // { id, name }
  const [info, setInfo] = useState({}); // ultima stare primită
  const [left, setLeft] = useState(0);
  const [score, setScore] = useState(0);
  const room = useRef(null); // canalul tabla -> toate telefoanele
  const myRoom = useRef(null); // canalul personal
  const pinRef = useRef('');
  const meRef = useRef(null);
  const qIndexRef = useRef(-1);
  const answeredRef = useRef(-1);
  const joinTimer = useRef(null);
  const tick = useRef(null);

  useEffect(() => {
    const p = params.get('pin');
    if (p) setPin(p.replace(/\D/g, '').slice(0, 6));
    try {
      const saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) || 'null');
      if (saved && saved.pin && saved.id) {
        setName(saved.name || '');
        if (!p || p === saved.pin) {
          setPin(saved.pin);
          connect(saved.pin, saved.name, saved.id);
        }
      } else {
        const n = localStorage.getItem('quiz-live-name');
        if (n) setName(n);
      }
    } catch {}
    return () => {
      clearInterval(tick.current);
      clearTimeout(joinTimer.current);
      if (room.current) room.current.close();
      if (myRoom.current) myRoom.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCountdown(seconds) {
    clearInterval(tick.current);
    const end = Date.now() + seconds * 1000;
    setLeft(Math.ceil(seconds));
    tick.current = setInterval(() => {
      const l = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) clearInterval(tick.current);
    }, 250);
  }

  function applyState(s) {
    if (!s || !s.phase) return;
    const id = meRef.current && meRef.current.id;
    setInfo(s);
    if (typeof s.score === 'number') setScore(s.score);
    switch (s.phase) {
      case 'lobby':
        setStage('waiting');
        break;
      case 'intro':
        qIndexRef.current = s.qIndex;
        setStage('intro');
        break;
      case 'question':
        qIndexRef.current = s.qIndex;
        if (s.answered || answeredRef.current === s.qIndex) {
          setStage('answered');
        } else {
          setStage('question');
        }
        startCountdown(s.remaining ?? s.question.time);
        break;
      case 'reveal': {
        clearInterval(tick.current);
        const r = s.results && s.results[id];
        if (r) setScore(r.score);
        setStage('reveal');
        break;
      }
      case 'scoreboard':
        setStage('scoreboard');
        break;
      case 'podium': {
        const f = s.final && s.final[id];
        if (f) setScore(f.score);
        setStage('podium');
        sessionStorage.removeItem(SAVE_KEY);
        break;
      }
      case 'closed':
        setStage('closed');
        sessionStorage.removeItem(SAVE_KEY);
        break;
      default:
    }
  }

  function connect(p, n, existingId) {
    setErr('');
    const id = existingId || randomId();
    const player = { id, name: n };
    meRef.current = player;
    setMe(player);
    setStage('connecting');
    pinRef.current = p;
    closeRooms();
    let ready = 0;
    const onStatus = async (status) => {
      if (status === 'SUBSCRIBED') {
        ready += 1;
        if (ready < 2) return;
        await postTo(topics.up(p), 'join', { id, name: n });
        clearTimeout(joinTimer.current);
        joinTimer.current = setTimeout(() => {
          if (stageIsJoining()) {
            setErr('Nu am găsit jocul cu acest PIN. Verificați cifrele de pe tablă și încercați din nou.');
            setStage('join');
            sessionStorage.removeItem(SAVE_KEY);
            closeRooms();
          }
        }, 6000);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setErr('Conexiunea a eșuat. Verificați internetul telefonului și încercați din nou.');
        setStage('join');
      }
    };
    myRoom.current = joinTopic(
      topics.me(p, id),
      {
        welcome: (w) => {
          if (!w || w.id !== meRef.current.id) return;
          clearTimeout(joinTimer.current);
          meRef.current = { id: w.id, name: w.name };
          setMe(meRef.current);
          sessionStorage.setItem(SAVE_KEY, JSON.stringify({ pin: p, id: w.id, name: n }));
          applyState(w.snapshot);
          if (w.snapshot && w.snapshot.phase === 'lobby') setStage('waiting');
        },
      },
      onStatus
    );
    room.current = joinTopic(
      topics.down(p),
      {
        state: (s) => {
          if (stageIsJoining()) return;
          applyState(s);
        },
      },
      onStatus
    );
  }

  function closeRooms() {
    if (room.current) { room.current.close(); room.current = null; }
    if (myRoom.current) { myRoom.current.close(); myRoom.current = null; }
  }

  const stageRef = useRef(stage);
  stageRef.current = stage;
  function stageIsJoining() {
    return stageRef.current === 'connecting';
  }

  function submitJoin(e) {
    e.preventDefault();
    const p = pin.replace(/\D/g, '');
    const n = name.trim();
    if (p.length !== 6) return setErr('PIN-ul are 6 cifre.');
    if (n.length < 3) return setErr('Scrieți numele și prenumele.');
    localStorage.setItem('quiz-live-name', n);
    connect(p, n);
  }

  async function answer(choice) {
    if (stage !== 'question') return;
    const qIndex = qIndexRef.current;
    answeredRef.current = qIndex;
    setInfo((s) => ({ ...s, myChoice: choice }));
    setStage('answered');
    if (navigator.vibrate) navigator.vibrate(40);
    const ok = await postReliable(topics.up(pinRef.current), 'answer', { id: meRef.current.id, qIndex, choice });
    if (!ok) setErr('Răspunsul nu a putut fi trimis. Verificați conexiunea.');
  }

  const top = (
    <header className="phone-top">
      <span>{me && stage !== 'join' && stage !== 'connecting' ? me.name : 'Quiz live'}</span>
      <span>{me && stage !== 'join' && stage !== 'connecting' ? `${score} puncte` : MODE === 'local' ? 'mod demonstrativ' : ''}</span>
    </header>
  );

  if (stage === 'join' || stage === 'connecting') {
    return (
      <div className="phone">
        {top}
        <main className="phone-main">
          <div className="center">
            <form className="join-card" onSubmit={submitJoin}>
              <h1>Intră în joc</h1>
              <div>
                <label htmlFor="pin">PIN-ul jocului (de pe tablă)</label>
                <input id="pin" className="pin-input" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              </div>
              <div>
                <label htmlFor="name">Numele și prenumele</label>
                <input id="name" autoComplete="name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
                <p className="help">Numele apare pe tablă și în rezultatele profesorului.</p>
              </div>
              {err && <p className="err" role="alert">{err}</p>}
              <button className="btn btn-primary" type="submit" disabled={stage === 'connecting'}>
                {stage === 'connecting' ? 'Se conectează…' : 'Intră'}
              </button>
              <a href="/tabla" className="help" style={{ textAlign: 'center' }}>Sunteți profesorul? Deschideți tabla jocului</a>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const header = info.total ? <span className="ptimer">Întrebarea {(info.qIndex ?? 0) + 1} din {info.total}</span> : null;

  let body;
  if (stage === 'waiting') {
    body = (
      <div className="center">
        <div className="big">Ești în joc!</div>
        <div className="mid">Numele tău apare pe tablă. Așteaptă începerea.</div>
        <div className="spinner" aria-hidden />
      </div>
    );
  } else if (stage === 'intro') {
    body = (
      <div className="center">
        {header}
        <div className="big">Pregătește-te…</div>
        <div className="mid">Citește întrebarea de pe tablă.</div>
        <div className="spinner" aria-hidden />
      </div>
    );
  } else if (stage === 'question') {
    body = (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>{header}<span className="ptimer" aria-live="off">{left} s</span></div>
        <div className="pq">{info.question?.text}</div>
        <div className="pgrid">
          {info.question?.answers.map((a, i) => (
            <button key={i} className={`opt ${OPTIONS[i].cls}`} onClick={() => answer(i)}>
              <Shape index={i} size={26} />
              <span className="letter">{OPTIONS[i].letter}</span>
              <span>{a}</span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (stage === 'answered') {
    const c = info.myChoice;
    body = (
      <div className="center">
        {header}
        <div className="big">Răspuns trimis</div>
        {typeof c === 'number' && (
          <div className={`opt ${OPTIONS[c].cls}`} style={{ width: 'min(420px,100%)' }}>
            <Shape index={c} size={26} /><span className="letter">{OPTIONS[c].letter}</span><span>{info.question?.answers[c]}</span>
          </div>
        )}
        <div className="mid">Așteaptă rezultatul. Timp rămas: {left} s</div>
        {err && <p className="err" role="alert" style={{ color: '#ffd1cc' }}>{err}</p>}
      </div>
    );
  } else if (stage === 'reveal') {
    const r = info.results && me && info.results[me.id];
    const cls = !r || !r.answered ? 'none' : r.correct ? 'ok' : 'bad';
    body = (
      <div className="center">
        {header}
        <div className={`result ${cls}`} role="status">
          <div className="icon" aria-hidden>{cls === 'ok' ? '✓' : cls === 'bad' ? '✕' : '…'}</div>
          <div className="big">{cls === 'ok' ? 'Corect!' : cls === 'bad' ? 'Greșit' : 'Nu ai răspuns'}</div>
          {r && r.correct && <div className="gain">+{r.gained}</div>}
          {r && r.streak >= 2 && <div className="mid">{r.streak} răspunsuri corecte la rând</div>}
          {cls !== 'ok' && <div className="mid">Răspunsul corect: {OPTIONS[info.correct]?.letter}. {info.correctText}</div>}
        </div>
        {r && <div className="mid">Ești pe locul {r.rank} din {info.players}</div>}
      </div>
    );
  } else if (stage === 'scoreboard') {
    body = (
      <div className="center">
        <div className="big">Privește clasamentul pe tablă</div>
        <div className="mid">Ai {score} puncte.</div>
        <div className="spinner" aria-hidden />
      </div>
    );
  } else if (stage === 'podium') {
    const f = info.final && me && info.final[me.id];
    body = (
      <div className="center">
        <div className="big">Jocul s-a încheiat</div>
        {f && <div className="result ok" style={{ background: f.rank <= 3 ? '#8a5a00' : '#1d3a6b' }}>
          <div className="icon" aria-hidden>{f.rank}</div>
          <div className="big">Locul {f.rank} din {info.players}</div>
          <div className="mid">{f.score} puncte · {f.correctCount} din {info.total} corecte</div>
        </div>}
        <button className="btn" onClick={() => { sessionStorage.removeItem(SAVE_KEY); setStage('join'); setPin(''); setScore(0); }}>Intră în alt joc</button>
      </div>
    );
  } else if (stage === 'closed') {
    body = (
      <div className="center">
        <div className="big">Profesorul a închis jocul</div>
        <button className="btn" onClick={() => { setStage('join'); setPin(''); setScore(0); }}>Intră în alt joc</button>
      </div>
    );
  }

  return (
    <div className="phone">
      {top}
      <main className="phone-main">{body}</main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Player />
    </Suspense>
  );
}
