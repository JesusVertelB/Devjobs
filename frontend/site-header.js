(() => {
  const token = sessionStorage.getItem('devjobs-token');
  if (!token) return;

  async function loadProfile() {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) {
        sessionStorage.removeItem('devjobs-token');
        sessionStorage.removeItem('devjobs-user');
        return;
      }
      if (!response.ok) return;

      const { user } = await response.json();
      if (!user) return;

      document.querySelectorAll('body > header').forEach((header) => {
        const actions = header.querySelector(':scope > div');
        if (!actions || actions.querySelector('.site-header__account')) return;

        const links = [...actions.querySelectorAll('a')];
        const loginLink = links.find((link) => link.getAttribute('href')?.endsWith('IniciarSesion.html'));
        const publishLink = links.find((link) => link.getAttribute('href')?.endsWith('PublicarEmpleo.html'));
        if (loginLink) loginLink.hidden = true;
        if (publishLink) publishLink.hidden = true;

        const account = document.createElement('div');
        account.className = 'site-header__account';

        const trigger = document.createElement('button');
        trigger.className = 'site-header__profile-trigger';
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');

        const avatar = document.createElement('span');
        avatar.className = 'site-header__profile-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = user.full_name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toLocaleUpperCase('es');

        const name = document.createElement('span');
        name.className = 'site-header__profile-name';
        name.textContent = user.full_name.trim().split(/\s+/)[0];

        const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('stroke-width', '1.8');
        chevron.setAttribute('stroke-linecap', 'round');
        chevron.setAttribute('stroke-linejoin', 'round');
        chevron.setAttribute('aria-hidden', 'true');
        const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        chevronPath.setAttribute('d', 'm6 9 6 6 6-6');
        chevron.append(chevronPath);
        trigger.append(avatar, name, chevron);

        const menu = document.createElement('div');
        menu.className = 'site-header__profile-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;

        const fullName = document.createElement('p');
        fullName.className = 'site-header__profile-full-name';
        fullName.textContent = user.full_name;
        const email = document.createElement('p');
        email.className = 'site-header__profile-email';
        email.textContent = user.email;
        const role = document.createElement('p');
        role.className = 'site-header__profile-role';
        role.textContent = user.account_type === 'employer' ? 'Cuenta de empresa' : 'Cuenta de candidato';
        menu.append(fullName, email, role);

        if (user.account_type === 'employer') {
          const publish = document.createElement('a');
          publish.className = 'site-header__profile-action';
          publish.href = 'PublicarEmpleo.html';
          publish.setAttribute('role', 'menuitem');
          publish.textContent = 'Publicar un empleo';
          menu.append(publish);
        } else if (user.account_type === 'candidate') {
          const profileLink = document.createElement('a');
          profileLink.className = 'site-header__profile-action';
          profileLink.href = 'Perfil.html';
          profileLink.setAttribute('role', 'menuitem');
          profileLink.textContent = 'Mi perfil';
          menu.append(profileLink);
        }

        const separator = document.createElement('span');
        separator.className = 'site-header__profile-separator';
        separator.setAttribute('aria-hidden', 'true');
        menu.append(separator);

        const signOut = document.createElement('button');
        signOut.className = 'site-header__profile-signout';
        signOut.type = 'button';
        signOut.setAttribute('role', 'menuitem');
        signOut.textContent = 'Cerrar sesión';
        signOut.addEventListener('click', () => {
          sessionStorage.removeItem('devjobs-token');
          sessionStorage.removeItem('devjobs-user');
          window.location.assign('IniciarSesion.html');
        });
        menu.append(signOut);

        trigger.addEventListener('click', () => {
          const isOpen = trigger.getAttribute('aria-expanded') === 'true';
          trigger.setAttribute('aria-expanded', String(!isOpen));
          menu.hidden = isOpen;
        });

        account.append(trigger, menu);
        actions.append(account);

        document.addEventListener('click', (event) => {
          if (!account.contains(event.target)) {
            trigger.setAttribute('aria-expanded', 'false');
            menu.hidden = true;
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            trigger.setAttribute('aria-expanded', 'false');
            menu.hidden = true;
          }
        });
      });
    } catch {}
  }

  loadProfile();
})();