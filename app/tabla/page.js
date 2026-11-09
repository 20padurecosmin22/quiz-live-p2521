'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QUIZZES, LESSON, getQuiz } from '@/lib/quizzes';
import { joinTopic, postTo, topics, MODE } from '@/lib/room';
import { OPTIONS, Shape } from '@/lib/shapes';

const INTRO_SECONDS = 4;

function newPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function pointsFor(elapsed, limit) {
  const ratio = Math.min(Math.max(elapsed / limit, 0), 1);
  return Math.round(1000 * (1 - ratio / 2));
}

export default function Tabla() {
  const G = useRef(null);
  const room = useRef(null); // canalul tabla -> telefoane
  const upRoom = useRef(null); // canalul telefoane -> tabla
  const timer = useRef(null);
  const [, render] = useReducer((x) => x + 1, 0);
  const [qr, setQr] = useState('');
  const [origin, setOrigin] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    const warn = (e) => {
      if (G.current && G.current.phase !== 'setup' && G.current.phase !== 'podium') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    const keys = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('keydown', keys);
      clearInterval(timer.current);
      if (room.current) room.current.close();
      if (upRoom.current) upRoom.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const g = G.current;

  // ---------- comunicare ----------
  function broadcast(payload) {
    if (room.current) room.current.send('state', payload);
  }

  function snapshotFor(id) {
    const s = G.current;
    const p = s.players[id];
    const base = { phase: s.phase, qIndex: s.qIndex, total: s.questions.length, title: s.title, score: p ? p.score : 0 };
    if (s.phase === 'question') {
      const q = s.questions[s.qIndex];
      const left = Math.max(0, q.time - (Date.now() - s.qStart) / 1000);
      return { ...base, question: { text: q.text, answers: q.answers, time: q.time }, remaining: left, answered: !!s.answers[id] };
    }
    if (s.phase === 'intro') {
      return { ...base, question: { text: s.questions[s.qIndex].text } };
    }
    return base;
  }

  function onJoin({ id, name }) {
    const s = G.current;
    if (!s || !id) return;
    let clean = String(name || '').trim().slice(0, 24) || 'Fără nume';
    if (!s.players[id]) {
      const taken = Object.values(s.players).map((p) => p.name);
      let n = clean, k = 2;
      while (taken.includes(n)) n = `${clean} ${k++}`;
      s.players[id] = { id, name: n, score: 0, streak: 0, correctCount: 0, history: [] };
      s.order.push(id);
    }
    postTo(topics.me(s.pin, id), 'welcome', { id, name: s.players[id].name, snapshot: snapshotFor(id) });
    render();
  }

  function onAnswer({ id, qIndex, choice }) {
    const s = G.current;
    if (!s || s.phase !== 'question' || qIndex !== s.qIndex) return;
    if (!s.players[id] || s.answers[id]) return;
    if (![0, 1, 2, 3].includes(choice)) return;
    s.answers[id] = { choice, elapsed: (Date.now() - s.qStart) / 1000 };
    render();
    if (Object.keys(s.answers).length >= s.order.length) endQuestion();
  }

  // ---------- etapele jocului ----------
  async function createGame(key) {
    const quiz = getQuiz(key);
    const pin = newPin();
    G.current = {
      pin, key, title: quiz.title, questions: quiz.questions,
      players: {}, order: [], qIndex: -1, phase: 'lobby',
      answers: {}, qStart: 0, timeLeft: 0, lastResults: null,
    };
    if (room.current) room.current.close();
    if (upRoom.current) upRoom.current.close();
    room.current = joinTopic(topics.down(pin), {}, () => {});
    upRoom.current = joinTopic(topics.up(pin), { join: onJoin, answer: onAnswer }, setStatus);
    const url = `${window.location.origin}/?pin=${pin}`;
    setQr(await QRCode.toDataURL(url, { margin: 1, width: 460, errorCorrectionLevel: 'M' }));
    render();
  }

  function nextQuestion() {
    const s = G.current;
    s.qIndex += 1;
    if (s.qIndex >= s.questions.length) return showPodium();
    s.phase = 'intro';
    s.answers = {};
    broadcast(snapshotFor(null));
    render();
    clearTimeout(timer.current);
    timer.current = setTimeout(startAnswering, INTRO_SECONDS * 1000);
  }

  function startAnswering() {
    const s = G.current;
    const q = s.questions[s.qIndex];
    s.phase = 'question';
    s.qStart = Date.now();
    s.timeLeft = q.time;
    broadcast({ phase: 'question', qIndex: s.qIndex, total: s.questions.length, title: s.title, question: { text: q.text, answers: q.answers, time: q.time }, remaining: q.time });
    render();
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      const left = Math.ceil(q.time - (Date.now() - s.qStart) / 1000);
      if (left !== s.timeLeft) { s.timeLeft = Math.max(0, left); render(); }
      if (left <= 0) endQuestion();
    }, 200);
  }

  function endQuestion() {
    const s = G.current;
    if (s.phase !== 'question') return;
    clearInterval(timer.current);
    const q = s.questions[s.qIndex];
    const results = {};
    for (const id of s.order) {
      const p = s.players[id];
      const a = s.answers[id];
      const correct = !!a && a.choice === q.correct;
      let gained = 0;
      if (correct) {
        p.streak += 1;
        gained = pointsFor(a.elapsed, q.time) + Math.min(500, 100 * (p.streak - 1));
        p.correctCount += 1;
      } else {
        p.streak = 0;
      }
      p.score += gained;
      p.history.push(a ? OPTIONS[a.choice].letter : '-');
      results[id] = { answered: !!a, correct, gained, score: p.score, streak: p.streak };
    }
    const ranking = [...s.order].sort((x, y) => s.players[y].score - s.players[x].score);
    ranking.forEach((id, i) => { results[id].rank = i + 1; });
    const counts = [0, 0, 0, 0];
    Object.values(s.answers).forEach((a) => { counts[a.choice] += 1; });
    s.counts = counts;
    s.lastResults = results;
    s.phase = 'reveal';
    broadcast({ phase: 'reveal', qIndex: s.qIndex, total: s.questions.length, title: s.title, correct: q.correct, correctText: q.answers[q.correct], results, players: s.order.length });
    render();
  }

  function topList(n) {
    const s = G.current;
    return [...s.order].sort((x, y) => s.players[y].score - s.players[x].score).slice(0, n).map((id) => s.players[id]);
  }

  function showScoreboard() {
    const s = G.current;
    s.phase = 'scoreboard';
    broadcast({ phase: 'scoreboard', qIndex: s.qIndex, total: s.questions.length, title: s.title, top: topList(5).map((p) => ({ name: p.name, score: p.score })) });
    render();
  }

  function showPodium() {
    const s = G.current;
    clearTimeout(timer.current);
    clearInterval(timer.current);
    s.phase = 'podium';
    const ranking = [...s.order].sort((x, y) => s.players[y].score - s.players[x].score);
    const final = {};
    ranking.forEach((id, i) => { final[id] = { rank: i + 1, score: s.players[id].score, correctCount: s.players[id].correctCount }; });
    broadcast({ phase: 'podium', total: s.questions.length, title: s.title, final, players: s.order.length, top: topList(3).map((p) => ({ name: p.name, score: p.score })) });
    render();
  }

  function advance() {
    const s = G.current;
    if (!s) return;
    if (s.phase === 'lobby' && s.order.length > 0) return nextQuestion();
    if (s.phase === 'question') return endQuestion();
    if (s.phase === 'reveal') return s.qIndex + 1 >= s.questions.length ? showPodium() : showScoreboard();
    if (s.phase === 'scoreboard') return nextQuestion();
  }

  function newGame() {
    clearTimeout(timer.current);
    clearInterval(timer.current);
    if (room.current) { const r = room.current; r.send('state', { phase: 'closed' }).finally(() => r.close()); room.current = null; }
    if (upRoom.current) { upRoom.current.close(); upRoom.current = null; }
    G.current = null;
    setQr('');
    render();
  }

  function downloadCsv() {
    const s = G.current;
    const head = ['Locul', 'Numele', 'Punctaj', 'Răspunsuri corecte', ...s.questions.map((_, i) => `Î${i + 1}`)];
    const correctRow = ['', 'Răspunsul corect', '', '', ...s.questions.map((q) => OPTIONS[q.correct].letter)];
    const rows = [...s.order]
      .sort((x, y) => s.players[y].score - s.players[x].score)
      .map((id, i) => {
        const p = s.players[id];
        return [i + 1, p.name, p.score, `${p.correctCount}/${s.questions.length}`, ...p.history];
      });
    const csv = [head, correctRow, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `rezultate-${s.key}-${d.toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  // ---------- afișare ----------
  const top = (
    <header className="board-top">
      <span className="brand">Quiz live · Planificarea aplicațiilor desktop</span>
      <span className="right">
        {MODE === 'local' && <span className="badge" title="Lipsesc variabilele Supabase">Mod demonstrativ: doar în acest browser</span>}
        {g && g.phase !== 'lobby' && g.phase !== 'setup' && <span>PIN {g.pin} · {g.order.length} jucători</span>}
        <button className="btn" onClick={toggleFullscreen}>Ecran complet (F)</button>
        {g && <button className="btn" onClick={() => { if (confirm('Închideți jocul curent? Punctajele se pierd.')) newGame(); }}>Joc nou</button>}
      </span>
    </header>
  );

  if (!g) {
    return (
      <div className="board">
        {top}
        <main className="board-main setup">
          <h1>Alegeți runda</h1>
          <p className="lead">{LESSON}. Studenții intră de pe telefon cu PIN-ul afișat pe tablă.</p>
          <div className="cards">
            {QUIZZES.map((q, i) => (
              <button key={q.key} className={`card ${q.key === 'toate' ? 'all' : ''}`} onClick={() => createGame(q.key)}>
                <span className="num">{q.key === 'toate' ? 'Joc complet' : q.key === 'boss' ? 'Final' : `Runda ${i + 1}`}</span>
                <h2>{q.title}</h2>
                <span className="meta">{q.questions.length} întrebări · {Math.round(q.questions.reduce((t, x) => t + x.time + INTRO_SECONDS + 12, 0) / 60)} min aprox.</span>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const q = g.qIndex >= 0 ? g.questions[g.qIndex] : null;
  const answeredCount = Object.keys(g.answers).length;

  if (g.phase === 'lobby') {
    const url = `${origin.replace(/^https?:\/\//, '')}`;
    return (
      <div className="board">
        {top}
        <main className="board-main">
          <div className="lobby">
            <div className="join-box">
              <div className="step">1. Deschideți pe telefon</div>
              <div className="url">{url}</div>
              <div className="pin-label">2. Introduceți PIN-ul jocului</div>
              <div className="pin" aria-label={`PIN ${g.pin.split('').join(' ')}`}>{g.pin}</div>
              {qr && <img src={qr} alt="Cod QR pentru intrarea în joc" />}
              <div className="step">sau scanați codul QR</div>
            </div>
            <div className="players-box">
              <h2>{g.title}<span className="count" aria-live="polite">{g.order.length}</span></h2>
              {status && status !== 'SUBSCRIBED' && <p className="empty">Se conectează la server ({status})…</p>}
              {g.order.length === 0 ? (
                <p className="empty">Așteptăm jucătorii…</p>
              ) : (
                <div className="chips">{g.order.map((id) => <span className="chip" key={id}>{g.players[id].name}</span>)}</div>
              )}
              <div className="lobby-actions">
                <button className="btn btn-start" disabled={g.order.length === 0} onClick={nextQuestion}>Începe jocul</button>
              </div>
              <p className="empty" style={{ marginTop: 14 }}>{g.questions.length} întrebări. Tastele Spațiu, Enter sau săgeata dreapta trec mai departe.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (g.phase === 'intro') {
    return (
      <div className="board">
        {top}
        <main className="board-main">
          <div className="intro-wrap">
            <div className="qhead"><span>Întrebarea {g.qIndex + 1} din {g.questions.length}</span><span>{g.title}</span></div>
            <div className="qtext">{q.text}</div>
            <div className="intro-bar"><span key={g.qIndex} style={{ animationDuration: `${INTRO_SECONDS}s` }} /></div>
          </div>
        </main>
      </div>
    );
  }

  if (g.phase === 'question' || g.phase === 'reveal') {
    const reveal = g.phase === 'reveal';
    const max = Math.max(1, ...(g.counts || [1]));
    return (
      <div className="board">
        {top}
        <main className="board-main">
          <div className="qhead"><span>Întrebarea {g.qIndex + 1} din {g.questions.length}</span><span>{g.title}</span></div>
          <div className="qtext">{q.text}</div>
          <div className="qmiddle">
            {!reveal ? (
              <>
                <div className={`timer ${g.timeLeft <= 5 ? 'low' : ''}`} aria-live="off">{g.timeLeft}</div>
                <div className="answered" aria-live="polite"><b>{answeredCount}</b><span>răspunsuri din {g.order.length}</span></div>
              </>
            ) : (
              <div className="dist" aria-label="Distribuția răspunsurilor">
                {OPTIONS.map((o, i) => (
                  <div className="col" key={i}>
                    <span className="val">{g.counts[i]}</span>
                    <div className={`bar ${o.cls} ${i === q.correct ? '' : 'dim'}`} style={{ height: `${(g.counts[i] / max) * 140 + 8}px` }}>
                      {i === q.correct && <span aria-hidden>✓</span>}
                    </div>
                    <span className="lab"><Shape index={i} size={18} />{o.letter}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="optgrid">
            {q.answers.map((a, i) => (
              <div key={i} className={`opt ${OPTIONS[i].cls} ${reveal && i !== q.correct ? 'dim' : ''}`}>
                <Shape index={i} size={34} />
                <span className="letter">{OPTIONS[i].letter}</span>
                <span>{a}</span>
                {reveal && i === q.correct && <span className="tick" aria-label="răspuns corect">✓</span>}
              </div>
            ))}
          </div>
          <div className="foot-actions">
            <span className="hint">{reveal ? 'Explicați răspunsul, apoi treceți mai departe.' : 'Întrebarea se încheie când răspund toți sau expiră timpul.'}</span>
            {!reveal && <button className="btn btn-next" onClick={endQuestion}>Oprește timpul</button>}
            {reveal && <button className="btn btn-next" onClick={advance}>{g.qIndex + 1 >= g.questions.length ? 'Clasamentul final' : 'Clasamentul'}</button>}
          </div>
        </main>
      </div>
    );
  }

  if (g.phase === 'scoreboard') {
    const list = topList(5);
    return (
      <div className="board">
        {top}
        <main className="board-main">
          <div className="score-wrap">
            <h1>Clasamentul după întrebarea {g.qIndex + 1}</h1>
            <div className="rows">
              {list.map((p, i) => (
                <div className="row" key={p.id} style={{ animationDelay: `${i * 0.08}s` }}>
                  <span className="pos">{i + 1}</span>
                  <span className="nm">{p.name}</span>
                  {p.streak >= 2 && <span className="streak">{p.streak} la rând</span>}
                  <span>{p.score}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="foot-actions">
            <button className="btn btn-next" onClick={nextQuestion}>Întrebarea următoare</button>
          </div>
        </main>
      </div>
    );
  }

  // podium
  const t3 = topList(3);
  const order = [t3[1], t3[0], t3[2]];
  const cls = ['p2', 'p1', 'p3'];
  const place = [2, 1, 3];
  return (
    <div className="board">
      {top}
      <main className="board-main">
        <div className="score-wrap">
          <h1>{g.title}: rezultatele finale</h1>
        </div>
        <div className="podium">
          {order.map((p, i) => p && (
            <div className={`pod ${cls[i]}`} key={p.id}>
              <span className="nm">{p.name}</span>
              <span className="pts">{p.score} puncte · {p.correctCount}/{g.questions.length} corecte</span>
              <div className="block">{place[i]}</div>
            </div>
          ))}
        </div>
        <div className="foot-actions">
          <span className="hint">{g.order.length} jucători. Fișierul CSV conține punctajul și răspunsul fiecărui student la fiecare întrebare.</span>
          <button className="btn" onClick={downloadCsv}>Descarcă rezultatele (CSV)</button>
          <button className="btn btn-next" onClick={newGame}>Joc nou</button>
        </div>
      </main>
    </div>
  );
}
