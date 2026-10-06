import { redirect } from 'next/navigation';

/** IFLCHAT is the only page in this template — send the root straight there. Remove this if you're dropping IFLCHAT into a project that already has its own homepage. */
export default function RootPage() {
  redirect('/chat');
}
