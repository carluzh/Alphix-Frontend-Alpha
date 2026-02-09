import { redirect } from 'next/navigation'

export default function PrivacyPage() {
  redirect('/legal/PrivacyPolicy.pdf')
}
