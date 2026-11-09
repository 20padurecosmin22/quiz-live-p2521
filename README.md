# Quiz live P2521

Joc de întrebări în timp real pentru lecțiile de Planificarea aplicațiilor desktop (Colegiul „Iulia Hasdeu” din Cahul).
Profesorul deschide pe tablă pagina `/tabla`, studenții intră de pe telefon pe pagina principală, cu PIN-ul afișat pe tablă.

Întrebările sunt cele patru runde de la tema 8 (Principiile interfeței desktop puse în practică în Figma):
Runda 1 Ergonomia, Runda 2 Accesibilitatea, Runda 3 Organizarea elementelor, Boss final, plus jocul complet cu toate cele 31 de întrebări.

## Cum funcționează

- Aplicația este făcută în Next.js și se publică pe Vercel ca site static.
- Legătura în timp real dintre tablă și telefoane trece prin Supabase Realtime (canale broadcast). Nu este nevoie de tabele în baza de date.
- Tabla păstrează tot jocul: întrebările, răspunsurile primite, timpul și punctajele. Telefoanele primesc doar ce trebuie să afișeze.
- Punctajul: răspunsul corect primește între 500 și 1000 de puncte, după cât de repede a venit, plus 100 de puncte pentru fiecare răspuns corect la rând (cel mult 500).
- La sfârșit, butonul „Descarcă rezultatele (CSV)” salvează punctajul și răspunsul fiecărui student la fiecare întrebare. Fișierul se deschide în Excel.
- Dacă un student reîncarcă pagina, revine în joc cu același punctaj. Tabla nu trebuie reîncărcată în timpul jocului.
- Fără variabilele Supabase, aplicația pornește în mod demonstrativ: merge doar între filele aceluiași browser (util pentru probă).

## Publicarea pe Vercel

1. Puneți codul într-un repository GitHub (de exemplu `quiz-live-p2521`).
2. Pe vercel.com: Add New, Project, Import, alegeți repository-ul. Framework: Next.js (se detectează singur). Apăsați Deploy.
3. În proiectul Vercel: Storage (sau Integrations), Supabase, Create. Alegeți regiunea Frankfurt (eu-central-1) și conectați baza nouă la proiect.
   Integrarea adaugă singură variabilele `NEXT_PUBLIC_SUPABASE_URL` și `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sau `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deployments, ultimul deploy, Redeploy, ca aplicația să primească variabilele.
5. Deschideți `https://adresa-proiectului.vercel.app/tabla`. Insigna „Mod demonstrativ” nu trebuie să mai apară.

Varianta manuală pentru pasul 3: creați un proiect pe supabase.com, copiați din Project Settings, API Keys, adresa proiectului și cheia publishable (sau anon),
apoi adăugați-le în Vercel, Settings, Environment Variables, cu numele `NEXT_PUBLIC_SUPABASE_URL` și `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

În Supabase, la Realtime, Settings, opțiunea „Allow public access” trebuie să rămână pornită (este pornită implicit).

## Modificarea întrebărilor

Întrebările sunt în `lib/quizzes.js`. Fiecare întrebare are textul, cele patru răspunsuri, timpul în secunde și indexul răspunsului corect (0 = A, 1 = B, 2 = C, 3 = D).
După modificare, faceți commit și push: Vercel publică singur noua versiune.

## Rularea pe calculator

```
npm install
npm run dev
```

Apoi deschideți http://localhost:3000/tabla și, în altă filă, http://localhost:3000.
Pentru legătura reală cu telefoanele, creați fișierul `.env.local` cu cele două variabile Supabase.

## Limitele planului gratuit Supabase

200 de conexiuni simultane și 100 de mesaje pe secundă sunt suficiente pentru o grupă de 35 de studenți.
Răspunsurile telefoanelor merg doar spre tablă, nu și spre celelalte telefoane, ca numărul de mesaje să rămână mic.
