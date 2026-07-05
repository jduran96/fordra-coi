import { verifySession } from '@/lib/dal'
import AppClient from './AppClient'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  await verifySession()
  return <AppClient />
}
