/** 접속한 주소의 origin. nginx 뒤에서는 X-Forwarded-Proto로 https를 알아낸다. */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
