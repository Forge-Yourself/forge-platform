import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forge Admin',
  description: 'Internal platform administration for Forge.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
