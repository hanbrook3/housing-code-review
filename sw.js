/* 건축 사업 법규검토 콘솔 — 오프라인 지원
   화면은 캐시에서 바로 꺼내 쓰고, 뒤에서 새 버전을 받아 둔다.
   판정 로직·조례 데이터는 index.html 안에 전부 들어 있어 인터넷 없이도 그대로 동작한다. */
/* ⚠ CacheStorage 는 스코프가 아니라 **오리진** 단위로 공유된다.
   같은 hanbrook3.github.io 에 다른 앱(/jeju-trip/)이 있으므로, 지우고 찾는 범위를
   반드시 이 앱 접두사로 한정한다. 한정하지 않으면 이웃 앱의 오프라인 캐시를 파괴한다. */
const PREFIX = 'housing-code-review-';
const CACHE = PREFIX + 'v1';

/* React 두 파일은 <head> 에서 불러오는데, 서비스워커 등록은 load 이후라
   첫 방문에서는 SW 를 거치지 않는다 → 미리 넣어 두지 않으면
   "설치 직후 오프라인 실행"이 흰 화면이 된다(앱 전체가 React 로 그려진다). */
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
];

/* 캐시해도 되는 바깥 자원 — 앱 구동에 필요하고 버전이 주소에 박혀 있다.
   여기 없는 호스트는 캐시하지 않고 그대로 네트워크로 보낸다.
   (법제처·자치법규·공공데이터 API 처럼 살아 있는 자료를 주는 곳을 캐시하면
    옛 답이 굳어 버린다. 허용 목록 방식이라 그런 사고가 원천 차단된다.) */
const CDN = /^(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* 새 버전을 받으면 열려 있는 화면에 알린다.
   matchAll 도 오리진 전체를 훑으므로 이웃 앱 탭에 알림이 잘못 가지 않도록 스코프로 거른다. */
function tellClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(cs => {
    cs.filter(c => c.url.indexOf(self.registration.scope) === 0)
      .forEach(c => { try { c.postMessage(msg); } catch (e) {} });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || CDN.test(url.hostname);
  if (!cacheable) return;                       /* 그 밖의 서버는 손대지 않는다 */

  const isDoc = req.mode === 'navigate' ||
    (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')));

  if (isDoc) {
    /* cache:'no-cache' 는 HTTP 캐시를 건너뛰되 조건부 요청(If-None-Match)은 살린다.
       'reload' 를 쓰면 한 글자도 안 바뀌었어도 매번 본문 전체(약 600KB)를 다시 받는다.
       배포처인 GitHub Pages 는 ETag 를 주므로 안 바뀌었을 때는 304 로 끝난다.
       waitUntil 없이는 응답을 돌려준 뒤 워커가 꺼져 갱신이 취소된다. */
    const update = fetch('./index.html', { cache: 'no-cache' })
      .then(res => {
        if (!res || !res.ok) return null;
        const copy = res.clone();
        return caches.open(CACHE).then(c =>
          c.match('./index.html')
            .then(old => (old ? old.text() : Promise.resolve('')))
            .then(oldText =>
              copy.text().then(newText => {
                if (oldText === newText) return res;
                return c.put('./index.html', new Response(newText, {
                  headers: { 'Content-Type': 'text/html; charset=utf-8' }
                })).then(() => tellClients({ type: 'updated' })).then(() => res);
              })
            )
        );
      })
      .catch(() => null);

    e.waitUntil(update);
    e.respondWith(
      caches.match('./index.html', { cacheName: CACHE })
        .then(hit => hit || update.then(r => r || fetch(req)))
    );
    return;
  }

  /* 아이콘·글꼴·React 등 — 캐시에 있으면 쓰고, 없으면 받아서 넣어 둔다 */
  e.respondWith(
    caches.match(req, { cacheName: CACHE }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
        }
        return res;
      });
    })
  );
});
