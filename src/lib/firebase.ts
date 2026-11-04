// Firebase 연결 설정 — 이 값들은 공개되어도 괜찮은 정보예요.
// (실제 보안은 firestore.rules 의 규칙으로 지켜요)
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator, type User } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDFxiCnrXnYN6yY5K1W0WaGC-W56dD9OdI',
  authDomain: 'ilovegod-intl.firebaseapp.com',
  projectId: 'ilovegod-intl',
  storageBucket: 'ilovegod-intl.firebasestorage.app',
  messagingSenderId: '590321597688',
  appId: '1:590321597688:web:4648cfb6fed6e8a1150f0d',
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 개발용: 주소에 ?emulator=1 이 붙어 있으면 내 컴퓨터의 Firebase 흉내 서버에 연결
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('emulator')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/** 가입 없이 보이지 않는 임시 로그인 */
export async function ensureUser(): Promise<User> {
  await auth.authStateReady();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
}
