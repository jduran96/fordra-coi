import { redirect } from 'next/navigation'

// Entry points live on the marketing site (fordra.com) nav. Hitting the app root
// (app.fordra.com) means "the App" → send to the customer portal.
export default function Home() {
  redirect('/app')
}
