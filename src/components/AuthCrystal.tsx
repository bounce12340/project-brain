export function AuthCrystal() {
  return (
    <div className="auth-crystal" aria-hidden="true">
      <svg className="auth-crystal-svg" viewBox="0 0 100 180" focusable="false">
        <defs>
          <radialGradient id="auth-crystal-halo">
            <stop offset="0" stopColor="#35C8FF" stopOpacity=".55" />
            <stop offset=".55" stopColor="#1A6FA8" stopOpacity=".2" />
            <stop offset="1" stopColor="#1A6FA8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="auth-crystal-halo" cx="50" cy="90" rx="48" ry="86" fill="url(#auth-crystal-halo)" />
        <g className="auth-crystal-facets">
          <polygon points="50,4 22,42 50,42" fill="#1A6FA8" fillOpacity=".55" />
          <polygon points="50,4 78,42 50,42" fill="#35C8FF" fillOpacity=".85" />
          <polygon points="22,42 50,42 50,130 30,130" fill="#12507E" fillOpacity=".6" />
          <polygon points="50,42 78,42 70,130 50,130" fill="#2AA6DB" fillOpacity=".75" />
          <polygon points="30,130 50,130 50,176" fill="#0E3A5C" fillOpacity=".6" />
          <polygon points="50,130 70,130 50,176" fill="#1E86C2" fillOpacity=".8" />
        </g>
        <polygon className="auth-crystal-highlight" points="55,18 69,39 55,37" fill="#FFFFFF" fillOpacity=".5" />
        <polygon className="auth-crystal-frame" points="50,4 78,42 70,130 50,176 30,130 22,42" fill="none" stroke="#C8A24A" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
