const loginForm = document.getElementById('login-form');
const inboxBody = document.getElementById('submission-list');
const inboxStatus = document.getElementById('inbox-status');
let lockStarted = false;
let signingOut = false;

async function lockAdminPage() {
  if (!inboxBody || signingOut || lockStarted) return;
  lockStarted = true;
  inboxBody.replaceChildren();

  const page = document.querySelector('.admin-page');
  if (page) {
    page.replaceChildren();
    const card = document.createElement('section');
    card.className = 'admin-card glass';
    const heading = document.createElement('h1');
    heading.textContent = 'Admin dashboard locked';
    const status = document.createElement('p');
    status.className = 'form-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Locking the dashboard...';
    const retryButton = document.createElement('button');
    retryButton.className = 'btn primary';
    retryButton.type = 'button';
    retryButton.textContent = 'Retry locking';
    retryButton.hidden = true;
    retryButton.addEventListener('click', () => {
      retryButton.disabled = true;
      lockStarted = false;
      lockAdminPage();
    });
    card.append(heading, status, retryButton);
    page.append(card);

    try {
      await apiRequest('/api/admin/lock', {
        method: 'POST',
        body: '{}',
        keepalive: true,
      });
      window.location.replace('/admin/login');
    } catch (error) {
      status.textContent = error instanceof Error
        ? `Could not lock the dashboard: ${error.message}`
        : 'Could not lock the dashboard. Check your connection and retry.';
      status.classList.add('error');
      retryButton.hidden = false;
      retryButton.disabled = false;
    }
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The server returned a web page instead of an API response. Check that the Render web service is running the latest deployment.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an invalid JSON response. Check the Render service logs and deployment.');
  }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = loginForm.querySelector('.form-status');
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Signing in...';
    status.classList.remove('error', 'success');

    try {
      const credentials = Object.fromEntries(new FormData(loginForm).entries());
      await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      window.location.assign('/admin');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Sign in failed.';
      status.classList.add('error');
    } finally {
      button.disabled = false;
    }
  });
}

function appendCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value || '—';
  row.append(cell);
  return cell;
}

async function loadSubmissions() {
  if (!inboxBody || !inboxStatus || lockStarted) return;
  inboxStatus.textContent = 'Loading messages...';
  inboxStatus.classList.remove('error');

  try {
    const { submissions } = await apiRequest('/api/admin/submissions');
    if (lockStarted) return;
    inboxBody.replaceChildren();

    if (submissions.length === 0) {
      inboxStatus.textContent = 'There are no messages yet.';
      return;
    }

    submissions.forEach((submission) => {
      const row = document.createElement('tr');
      appendCell(row, new Date(submission.createdAt).toLocaleString());
      const submissionTypes = {
        admission: 'Admissions',
        contact: 'Contact',
        complaint: 'Parent complaint',
      };
      appendCell(row, submissionTypes[submission.type] || 'Contact');

      const details = document.createElement('td');
      const name = document.createElement('strong');
      name.textContent = submission.name;
      const email = document.createElement('a');
      email.href = `mailto:${encodeURIComponent(submission.email)}`;
      email.textContent = submission.email;
      details.append(name, document.createElement('br'), email);
      if (submission.phone) {
        const phone = document.createElement('div');
        phone.textContent = `Phone: ${submission.phone}`;
        details.append(phone);
      }
      if (submission.childInfo) {
        const childInfo = document.createElement('div');
        childInfo.textContent = `Child age/class: ${submission.childInfo}`;
        details.append(childInfo);
      }
      if (submission.category) {
        const category = document.createElement('div');
        category.textContent = `Concern: ${submission.category}`;
        details.append(category);
      }
      row.append(details);
      appendCell(row, submission.message);

      const statusCell = document.createElement('td');
      const statusSelect = document.createElement('select');
      statusSelect.setAttribute('aria-label', `Status for ${submission.name}`);
      [
        ['new', 'New'],
        ['contacted', 'Contacted'],
        ['archived', 'Archived'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = submission.status === value;
        statusSelect.append(option);
      });
      statusSelect.addEventListener('change', async () => {
        statusSelect.disabled = true;
        try {
          await apiRequest(`/api/admin/submissions/${submission.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: statusSelect.value }),
          });
          inboxStatus.textContent = 'Message status updated.';
        } catch (error) {
          inboxStatus.textContent = error instanceof Error ? error.message : 'Could not update status.';
          inboxStatus.classList.add('error');
          statusSelect.value = submission.status;
        } finally {
          statusSelect.disabled = false;
        }
      });
      statusCell.append(statusSelect);
      row.append(statusCell);
      inboxBody.append(row);
    });
    inboxStatus.textContent = `Showing ${submissions.length} message${submissions.length === 1 ? '' : 's'}.`;
  } catch (error) {
    if (error instanceof Error && error.message === 'Sign in required.') {
      window.location.replace('/admin/login');
      return;
    }
    inboxStatus.textContent = error instanceof Error ? error.message : 'Could not load messages.';
    inboxStatus.classList.add('error');
  }
}

document.getElementById('refresh-button')?.addEventListener('click', loadSubmissions);
document.getElementById('logout-button')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  signingOut = true;
  button.disabled = true;
  if (inboxBody) inboxBody.replaceChildren();
  if (inboxStatus) {
    inboxStatus.textContent = 'Signing out...';
    inboxStatus.classList.remove('error');
  }
  document.getElementById('refresh-button')?.setAttribute('disabled', '');

  try {
    await apiRequest('/api/admin/logout', { method: 'POST', body: '{}' });
    window.location.replace('/admin/login');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not sign out.';
    signingOut = false;
    button.disabled = false;
    document.getElementById('refresh-button')?.removeAttribute('disabled');
    await loadSubmissions();
    if (inboxStatus && !inboxStatus.classList.contains('error')) {
      inboxStatus.textContent = `${message} The inbox is still open.`;
      inboxStatus.classList.add('error');
    }
  }
});

if (inboxBody) loadSubmissions();

if (inboxBody) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') lockAdminPage();
  });
  window.addEventListener('blur', lockAdminPage);
  window.addEventListener('pagehide', lockAdminPage);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) loadSubmissions();
  });
}
