const repo = 'GSUS2K/discord-status';
const fallbackRelease = `https://github.com/${repo}/releases/latest`;
const platformData = {
  windows: { title: 'Windows companion', description: 'Setup is the normal choice. MSI is for managed or enterprise deployment.', icon: 'windows', files: [{ label: 'Windows Setup', detail: '.exe · x64 · Recommended', match: /Windows-x64-Setup\.exe$|x64-setup\.exe$/i }, { label: 'Windows MSI', detail: '.msi · x64 · Managed install', match: /Windows-x64-MSI\.msi$|x64_en-US\.msi$/i }] },
  macos: { title: 'macOS companion', description: 'Choose Apple Silicon for M-series Macs or Intel for older Macs.', icon: 'macos', files: [{ label: 'Apple Silicon', detail: '.dmg · ARM64 · M1 and newer', match: /macOS-Apple-Silicon\.dmg$|aarch64\.dmg$/i }, { label: 'Intel Mac', detail: '.dmg · x86_64', match: /macOS-Intel-x64\.dmg$|x64\.dmg$/i }] },
  linux: { title: 'Linux companion', description: 'AppImage runs portably. DEB integrates with Debian, Ubuntu, and compatible systems.', icon: 'linux', files: [{ label: 'Linux AppImage', detail: '.AppImage · x86_64 · Portable', match: /Linux-x86_64\.AppImage$|amd64\.AppImage$/i }, { label: 'Debian / Ubuntu', detail: '.deb · x86_64 · Package install', match: /Linux-Debian-Ubuntu-x86_64\.deb$|amd64\.deb$/i }] }
};
let release = null;
let selectedPlatform = 'windows';
const tabs = [...document.querySelectorAll('.platform-tab')];
const packageGrid = document.getElementById('packageGrid');

function renderPlatform(platform) {
  selectedPlatform = platform;
  const data = platformData[platform];
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.platform === platform));
  document.getElementById('platformTitle').textContent = data.title;
  document.getElementById('platformDescription').textContent = data.description;
  document.getElementById('platformVersion').textContent = release?.tag_name || 'Latest release';
  packageGrid.textContent = '';
  for (const file of data.files) {
    const asset = release?.assets?.find(item => file.match.test(item.name));
    const card = document.createElement('a');
    card.className = `package-card${asset ? '' : ' disabled'}`;
    card.href = asset?.browser_download_url || fallbackRelease;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.innerHTML = `<span class="package-icon">${packageIcon(data.icon)}</span><span><b>${file.label}</b><span>${file.detail}</span></span><strong>${asset ? 'Download ↓' : 'Release ↗'}</strong>`;
    packageGrid.append(card);
  }
}

function packageIcon(platform) {
  if (platform === 'windows') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.5 10.5 3v8H3Zm9-1.8L21 1v10h-9ZM3 12.5h7.5v8L3 19Zm9 0h9v10l-9-1.8Z"/></svg>';
  if (platform === 'macos') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.7 12.8c0-2.7 2.2-4 2.3-4.1a5 5 0 0 0-4-2.2c-1.7-.2-3.3 1-4.2 1-.9 0-2.2-1-3.7-.9a5.4 5.4 0 0 0-4.6 2.8c-2 3.4-.5 8.4 1.4 11.1 1 1.3 2 2.8 3.5 2.7 1.4-.1 2-1 3.7-1s2.2 1 3.7 1c1.5 0 2.5-1.4 3.4-2.7a12 12 0 0 0 1.6-3.2 4.8 4.8 0 0 1-3.1-4.5ZM14 4.8A4.8 4.8 0 0 0 15.2 1a4.9 4.9 0 0 0-3.3 1.8 4.5 4.5 0 0 0-1.2 3.5A4 4 0 0 0 14 4.8Z"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m5 0h5"/></svg>';
}

tabs.forEach(tab => tab.addEventListener('click', () => renderPlatform(tab.dataset.platform)));
async function loadRelease() {
  try {
    const [response, releasesResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }),
      fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } })
    ]);
    if (!response.ok) throw new Error('Release request failed');
    release = await response.json();
    document.getElementById('releaseLabel').textContent = release.tag_name;
    const releases = releasesResponse.ok ? await releasesResponse.json() : [release];
    const total = releases.reduce((sum, item) => sum + item.assets.reduce((assetSum, asset) => assetSum + (asset.download_count || 0), 0), 0);
    document.getElementById('downloadCount').textContent = `${total.toLocaleString()} total downloads`;
  } catch {
    document.getElementById('releaseLabel').textContent = 'Latest GitHub release';
  }
  renderPlatform(selectedPlatform);
}
const os = `${navigator.userAgentData?.platform || navigator.platform || ''}`.toLowerCase();
renderPlatform(os.includes('mac') ? 'macos' : os.includes('linux') ? 'linux' : 'windows');
loadRelease();

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
}, { threshold: .14 });
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

const canvas = document.getElementById('ambient');
const gl = canvas.getContext('webgl', { alpha: true, antialias: false });
if (gl && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const vertex = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fragment = 'precision mediump float;uniform vec2 r;uniform float t;float w(vec2 p,float f,float s){return sin(p.x*f+p.y*(f*.63)+t*s);}void main(){vec2 p=(gl_FragCoord.xy-.5*r)/r.y;float n=w(p,3.2,.17)+w(p.yx,5.1,-.11)+w(p+vec2(.7,-.3),7.4,.07);float b=exp(-6.*abs(p.y*.78+.12*sin(p.x*2.4+t*.08)));vec3 c=vec3(.015,.035,.075);c+=vec3(.025,.12,.32)*b*(.38+.18*n);c+=vec3(.02,.13,.17)*exp(-7.*abs(p.y+.36+.09*sin(p.x*3.-t*.1)))*.22;gl_FragColor=vec4(c,.72);}';
  const shader = (type, source) => { const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item); return item; };
  const program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program); gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const time = gl.getUniformLocation(program, 't'); const resolution = gl.getUniformLocation(program, 'r');
  const draw = now => { const scale = Math.min(devicePixelRatio || 1, 2); const width = Math.round(innerWidth * scale); const height = Math.round(innerHeight * scale); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } gl.viewport(0, 0, width, height); gl.uniform1f(time, now * .001); gl.uniform2f(resolution, width, height); gl.drawArrays(gl.TRIANGLES, 0, 6); requestAnimationFrame(draw); };
  requestAnimationFrame(draw);
}
