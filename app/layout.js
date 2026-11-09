import './globals.css';

export const metadata = {
  title: 'Quiz live P2521',
  description: 'Întrebări în timp real pentru lecțiile de Planificarea aplicațiilor desktop',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#14284B',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
