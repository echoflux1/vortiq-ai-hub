// GDPR Cookie Consent Banner with Accessibility
document.addEventListener('DOMContentLoaded', () => {
// Check if user already consented
if (localStorage.getItem('cookieConsent')) {
return;
}

// Create banner elements with ARIA attributes
const banner = document.createElement('div');
banner.id = 'cookie-banner';
banner.innerHTML = `
<div role="dialog" aria-live="polite" aria-labelledby="cookie-title" style="
position: fixed;
bottom: 0;
left: 0;
right: 0;
background-color: #1A232F;
color: #D8DDE3;
padding: 15px;
text-align: center;
border-top: 2px solid #CFA644;
z-index: 1000;
font-size: 14px;">
<p id="cookie-title" style="margin: 0; display: inline;">
We use cookies for analytics and personalized ads. 
<a href="/privacy.html" style="color: #CFA644;">Learn more</a>
</p>
<button id="accept-cookies" aria-label="Accept cookies" style="
background-color: #CFA644;
color: #1A232F;
border: none;
padding: 8px 20px;
margin-left: 15px;
border-radius: 5px;
cursor: pointer;
font-weight: bold;">Accept</button>
</div>`;

document.body.appendChild(banner);

// Handle acceptance
document.getElementById('accept-cookies').addEventListener('click', () => {
localStorage.setItem('cookieConsent', 'true');
banner.style.display = 'none';
});

// No auto-hide - user must explicitly accept
});
