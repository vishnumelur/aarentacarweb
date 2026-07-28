export const metadata = {
  title: 'AA Rentals — Car Rental in Dubai',
  description: 'Self-drive and chauffeur car rental across Dubai.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
