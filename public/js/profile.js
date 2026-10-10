// Profile page — pfp upload + username + name + bio + socials + password change.
// All dialogs go through toast / confirmToast / promptToast (no native alert/confirm/prompt).
//
// Avatar sync: after a successful upload (or save), we patch every place the user's
// avatar is rendered — the profile-page preview, the sidebar user-chip, and the
// topbar user-chip. We cache-bust with ?t=Date.now() because the /uploads/:id
// endpoint is immutable, but the avatar_url in the DB has changed.

document.addEventListener('DOMContentLoaded', () => {
  // ===== Bio counter (101 char limit) =====
  const bioInput = document.getElementById('profile-bio');
  const bioCounter = document.getElementById('bio-counter');
  if (bioInput && bioCounter) {
    const updateCounter = () => {
      bioCounter.textContent = `${bioInput.value.length}/101`;
      bioCounter.classList.toggle('over', bioInput.value.length >= 101);
    };
    bioInput.addEventListener('input', updateCounter);
    updateCounter();
  }

  // ===== Helper: refresh every avatar on the page (sidebar, topbar, preview) =====
  function refreshAllAvatars(avatarUrl) {
    const src = avatarUrl ? `${avatarUrl}?t=${Date.now()}` : null;
    const preview = document.getElementById('pfp-preview');
    if (preview) {
      if (src) {
        preview.classList.add('has-img');
        preview.style.background = '';
        // Preserve the pfp-overlay span when swapping the innerHTML.
        preview.innerHTML = `<img src="${src}" alt="" /><span class="pfp-overlay" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>`;
      } else {
        preview.classList.remove('has-img');
      }
    }
    document.querySelectorAll('.sidebar-user .avatar, .user-chip .avatar').forEach(av => {
      if (src) {
        av.classList.add('has-img');
        av.style.background = '';
        av.innerHTML = `<img src="${src}" alt="" />`;
      } else {
        av.classList.remove('has-img');
      }
    });
  }

  function refreshUsername(newUsername) {
    document.querySelectorAll('.sidebar-user-name, .user-name').forEach(el => {
      el.textContent = newUsername;
    });
  }

  // ===== Pfp upload — triggered by clicking the pfp itself =====
  const pfpPreview = document.getElementById('pfp-preview');
  const pfpInput = document.getElementById('pfp-input');
  if (pfpPreview && pfpInput) {
    // Click on the avatar (or pressing Enter / Space when focused) opens the file picker.
    pfpPreview.addEventListener('click', () => pfpInput.click());
    pfpPreview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pfpInput.click();
      }
    });
  }

  if (pfpInput) {
    pfpInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast.warn('Max 5MB.');
        e.target.value = '';
        return;
      }
      if (!/^image\//.test(file.type)) {
        toast.warn('Only image files are allowed.');
        e.target.value = '';
        return;
      }
      const fd = new FormData();
      fd.append('avatar', file);
      // Send the current username + name + bio + socials along so we don't lose them.
      fd.append('username', document.getElementById('profile-username').value);
      fd.append('name', document.getElementById('profile-name').value);
      if (document.getElementById('profile-bio')) fd.append('bio', document.getElementById('profile-bio').value);
      if (document.getElementById('social-facebook')) fd.append('socials', JSON.stringify({
        facebook: document.getElementById('social-facebook').value || '',
        instagram: document.getElementById('social-instagram').value || '',
        tiktok: document.getElementById('social-tiktok').value || '',
      }));
      try {
        const r = await fetch('/api/profile', { method: 'POST', body: fd });
        if (r.ok) {
          const d = await r.json();
          if (d.profile && d.profile.avatar_url) {
            refreshAllAvatars(d.profile.avatar_url);
          }
          toast.success('Profile picture updated.');
        } else {
          const d = await r.json().catch(() => ({}));
          toast.error(d.error || 'Failed to upload.');
        }
      } catch (err) {
        toast.error('Network error — please try again.');
      }
      e.target.value = '';
    });
  }

  // ===== Save profile (username + name + bio + socials) =====
  const saveBtn = document.getElementById('save-profile');
  const savedMsg = document.getElementById('profile-saved-msg');
  saveBtn?.addEventListener('click', async () => {
    const username = document.getElementById('profile-username').value.trim();
    const name = document.getElementById('profile-name').value.trim();
    const bio = (document.getElementById('profile-bio')?.value || '').slice(0, 101);
    const socials = {
      facebook: document.getElementById('social-facebook')?.value || '',
      instagram: document.getElementById('social-instagram')?.value || '',
      tiktok: document.getElementById('social-tiktok')?.value || '',
    };
    if (!username) { toast.warn('Username cannot be empty.'); return; }
    if (username.length < 3) { toast.warn('Username must be at least 3 characters.'); return; }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
      toast.warn('Username can only contain letters, numbers, dots, underscores, and dashes.');
      return;
    }
    if (bio.length > 101) { toast.warn('Bio must be 101 characters or fewer.'); return; }
    saveBtn.disabled = true;
    const originalText = saveBtn.innerHTML;
    saveBtn.textContent = 'Saving…';
    try {
      const r = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, bio, socials }),
      });
      if (r.ok) {
        const d = await r.json();
        toast.success('Profile saved.');
        if (d.profile?.username) refreshUsername(d.profile.username);
        if (savedMsg) {
          savedMsg.textContent = 'Saved.';
          setTimeout(() => { savedMsg.textContent = ''; }, 2500);
        }
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Failed.');
      }
    } catch (err) {
      toast.error('Network error — please try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalText;
    }
  });

  // ===== Change password =====
  document.getElementById('change-password-btn')?.addEventListener('click', async () => {
    const current = document.getElementById('current-password').value;
    const next = document.getElementById('new-password').value;
    const confirmPwd = document.getElementById('confirm-password').value;
    if (!current || !next) { toast.warn('Fill in the current and new passwords.'); return; }
    if (next.length < 6) { toast.warn('New password must be at least 6 characters.'); return; }
    if (next !== confirmPwd) { toast.warn('New password and confirmation do not match.'); return; }
    if (next === current) { toast.warn('New password must be different from the current one.'); return; }
    try {
      const r = await fetch('/api/profile/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        toast.success('Password changed.');
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        if (new URLSearchParams(location.search).get('mustChangePassword') === '1') {
          setTimeout(() => location.href = '/', 1200);
        }
      } else {
        toast.error(d.error || 'Failed to change password.');
      }
    } catch (err) {
      toast.error('Network error — please try again.');
    }
  });

  // ===== Sound toggle (live-test chime) =====
  // Persisted to localStorage — the live-test/take.ejs page reads 'stbh:sound'.
  // Default is ON (only chimes when tab is hidden + a live item changes).
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle) {
    const current = localStorage.getItem('stbh:sound');
    soundToggle.checked = current !== 'off';
    soundToggle.addEventListener('change', () => {
      localStorage.setItem('stbh:sound', soundToggle.checked ? 'on' : 'off');
      if (soundToggle.checked) {
        // Play a tiny preview chime so the user knows what it sounds like.
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          [880, 1175].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            osc.connect(gain).connect(ctx.destination);
            const start = ctx.currentTime + i * 0.12;
            osc.start(start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
            osc.stop(start + 0.2);
          });
          if (ctx.state === 'suspended') ctx.resume();
        } catch {}
        toast.success('Chime enabled. You\'ll hear it when the teacher advances a live test.');
      } else {
        toast.info('Chime muted.');
      }
    });
  }
});
