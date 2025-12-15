import LandingPage from '@/components/Landing/LandingPage'

export const dynamic = 'force-static'
export const revalidate = 86400

export default function Home() {
  return <LandingPage />
}
