'use client';

// Legătura în timp real dintre tablă (gazda jocului) și telefoane.
// Pe Vercel se folosește Supabase Realtime (canale broadcast, fără tabele în baza de date).
// Fără variabilele Supabase, aplicația merge în mod demonstrativ: doar între filele aceluiași browser.
//
// Trei canale pentru fiecare joc, ca telefoanele să nu primească mesajele celorlalte telefoane:
//   quiz-PIN          tabla -> toate telefoanele (întrebarea, rezultatele, clasamentul)
//   quiz-PIN-up       telefoane -> tabla (intrarea în joc, răspunsurile); îl ascultă doar tabla
//   quiz-PIN-me-ID    tabla -> un singur telefon (confirmarea intrării în joc)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const MODE = SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';

export const topics = {
  down: (pin) => `quiz-${pin}`,
  up: (pin) => `quiz-${pin}-up`,
  me: (pin, id) => `quiz-${pin}-me-${id}`,
};

let client = null;
function sb() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 40 } },
    });
  }
  return client;
}

/** Se abonează la un canal: primește evenimentele din handlers și poate trimite pe el. */
export function joinTopic(topic, handlers, onStatus) {
  if (MODE === 'supabase') {
    const channel = sb().channel(topic, { config: { broadcast: { self: false, ack: true } } });
    for (const [event, fn] of Object.entries(handlers)) {
      channel.on('broadcast', { event }, ({ payload }) => fn(payload));
    }
    channel.subscribe((status) => onStatus && onStatus(status));
    return {
      async send(event, payload) {
        try {
          return await channel.send({ type: 'broadcast', event, payload });
        } catch {
          return 'error';
        }
      },
      close() {
        sb().removeChannel(channel);
      },
    };
  }

  const bc = new BroadcastChannel(topic);
  bc.onmessage = (e) => {
    const { event, payload } = e.data || {};
    if (handlers[event]) handlers[event](payload);
  };
  setTimeout(() => onStatus && onStatus('SUBSCRIBED'), 0);
  return {
    async send(event, payload) {
      bc.postMessage({ event, payload });
      return 'ok';
    },
    close() {
      bc.close();
    },
  };
}

const postChannels = new Map();

/** Trimite un mesaj pe un canal fără a se abona la el (prin REST). Întoarce true dacă a reușit. */
export async function postTo(topic, event, payload) {
  if (MODE === 'supabase') {
    let ch = postChannels.get(topic);
    if (!ch) {
      ch = sb().channel(topic, { config: { broadcast: { self: false } } });
      postChannels.set(topic, ch);
    }
    try {
      const r = await ch.httpSend(event, payload);
      return !!(r && r.success);
    } catch {
      try {
        return (await ch.send({ type: 'broadcast', event, payload })) === 'ok';
      } catch {
        return false;
      }
    }
  }
  const bc = new BroadcastChannel(topic);
  bc.postMessage({ event, payload });
  bc.close();
  return true;
}

/** Trimite cu încercări repetate (pentru răspunsurile de pe telefon). */
export async function postReliable(topic, event, payload, tries = 3) {
  for (let i = 0; i < tries; i++) {
    if (await postTo(topic, event, payload)) return true;
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return false;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
