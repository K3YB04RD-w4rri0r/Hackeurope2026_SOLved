import { useState } from 'react';

function getSnippet(siteKey) {
  const key = siteKey || 'YOUR_SITE_KEY';
  return `<script src="https://solved.dev/widget.js" data-key="${key}"></script>`;
}

export default function EmbedSnippet({ siteKey }) {
  const [copied, setCopied] = useState(false);
  const snippet = getSnippet(siteKey);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  return (
    <div className="snippet-inline">
      <div className="snippet-code">
        <code>{snippet}</code>
      </div>
      <button className="copy-btn" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
