import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Schema Studio — Visual Database Designer', description: 'Rancang schema database secara visual. Tambah tabel, susun kolom, dan tarik relasi.' };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="id"><body>{children}</body></html>;
}
