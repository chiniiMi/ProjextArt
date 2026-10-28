import { useEffect, useRef, useState } from 'react';

const categories = ['All work', 'Artwork', 'Other'];

async function readApiResponse(response, fallbackMessage) {
  const responseBody = await response.text();
  let result;

  try {
    result = JSON.parse(responseBody);
  } catch {
    const isHtml = response.headers.get('content-type')?.includes('text/html')
      || responseBody.trimStart().startsWith('<');
    if (isHtml) {
      throw new Error(
        `The upload request reached a web page instead of the API (HTTP ${response.status}). `
        + 'Open the admin page on the same host as the API and make sure the API server is running.',
      );
    }
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const error = new Error(result.error || fallbackMessage);
    error.status = response.status;
    throw error;
  }
  return result;
}

function App() {
  const currentPath = typeof window === 'undefined'
    ? '/'
    : window.location.pathname.replace(/\/+$/, '') || '/';
  const isComicsPage = currentPath === '/comics';
  const isBooksPage = currentPath === '/books';
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All work');
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [authenticatorCode, setAuthenticatorCode] = useState('');
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [filePreviews, setFilePreviews] = useState([]);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [adminPreviewItem, setAdminPreviewItem] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editFields, setEditFields] = useState({ title: '', year: '', description: '', isLocked: false });
  const [editError, setEditError] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef(null);
  const lastActivityPingAt = useRef(0);
  const activityPingInProgress = useRef(false);

  const isAdminRoute = () => {
    if (typeof window === 'undefined') return false;
    const { hostname, pathname } = window.location;
    const adminHost = hostname.startsWith('admin.') || hostname.startsWith('admin-') || hostname === 'admin';
    const adminPath = pathname.includes('/apps/admin_') || pathname.startsWith('/admin_') || pathname.startsWith('/admin');
    return adminHost || adminPath;
  };

  const canAdminUpload = uploadEnabled && adminAuthenticated;

  async function loadItems() {
    const response = await fetch('/api/items');
    setItems(await readApiResponse(response, 'The gallery could not be loaded.'));
  }

  useEffect(() => {
    let active = true;

    Promise.all([
      fetch('/api/items').then((response) => {
        if (!response.ok) throw new Error('The gallery could not be loaded.');
        return response.json();
      }),
      fetch('/api/upload-config').then((response) => {
        if (!response.ok) throw new Error('Upload settings could not be loaded.');
        return response.json();
      }),
      fetch('/api/admin/session').then((response) => {
        if (!response.ok) throw new Error('Admin session status could not be loaded.');
        return response.json();
      }),
    ])
      .then(([galleryItems, uploadConfig, adminSession]) => {
        if (!active) return;
        setItems(galleryItems);
        setUploadEnabled(uploadConfig.enabled && isAdminRoute());
        setAdminAuthenticated(uploadConfig.enabled && isAdminRoute() && adminSession.authenticated);
        setSessionExpiresAt(adminSession.expiresAt);
      })
      .catch(() => {
        if (active) setError('The gallery is having a moment. Please refresh to try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      filePreviews.forEach((file) => {
        if (file.preview?.startsWith('blob:')) URL.revokeObjectURL(file.preview);
      });
    };
  }, [filePreviews]);

  useEffect(() => {
    if (!selectedItem) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') setSelectedItem(null);
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedItem]);

  useEffect(() => {
    if (!adminPreviewItem) return undefined;

    function closeAdminPreviewOnEscape(event) {
      if (event.key === 'Escape') {
        setAdminPreviewItem(null);
        setEditingItemId(null);
      }
    }

    window.addEventListener('keydown', closeAdminPreviewOnEscape);
    return () => window.removeEventListener('keydown', closeAdminPreviewOnEscape);
  }, [adminPreviewItem]);

  useEffect(() => {
    if (!sessionExpiresAt) return undefined;

    const timeoutId = window.setTimeout(() => {
      setAdminAuthenticated(false);
      setSessionExpiresAt(null);
      setAuthError('Your 10-minute admin session expired. Enter a new authenticator code to continue.');
      fetch('/api/admin/session', { method: 'DELETE' }).catch((logoutFailure) => {
        console.error('Could not clear the expired admin session cookie:', logoutFailure);
      });
    }, Math.max(0, sessionExpiresAt - Date.now()));

    return () => window.clearTimeout(timeoutId);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (!adminAuthenticated) return undefined;

    async function reportActivity() {
      const now = Date.now();
      if (activityPingInProgress.current || now - lastActivityPingAt.current < 15_000) return;

      activityPingInProgress.current = true;
      try {
        const response = await fetch('/api/admin/session/activity', { method: 'POST' });
        const session = await readApiResponse(response, 'Could not refresh the admin session.');
        lastActivityPingAt.current = Date.now();
        setSessionExpiresAt(session.expiresAt);
      } catch (activityFailure) {
        if (activityFailure.status === 401) {
          setAdminAuthenticated(false);
          setSessionExpiresAt(null);
          setAuthError('Your admin session expired. Sign in again to continue.');
        } else {
          console.error('Could not refresh the admin session:', activityFailure);
        }
      } finally {
        activityPingInProgress.current = false;
      }
    }

    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, reportActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, reportActivity);
      });
    };
  }, [adminAuthenticated]);

  const visibleItems = items.filter((item) => (
    item.section === 'gallery' && (activeCategory === 'All work' || item.category === activeCategory)
  ));

  function buildFileList(files) {
    return files.map((file) => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      key: `${file.name}-${file.size}-${file.lastModified}`,
    }));
  }

  function syncInputFiles(nextFiles) {
    if (!fileInputRef.current) return;
    const transfer = new DataTransfer();
    nextFiles.forEach((file) => transfer.items.add(file));
    fileInputRef.current.files = transfer.files;
  }

  function handleFileSelection(event) {
    const nextFiles = Array.from(event.target.files || []);
    setFilePreviews(buildFileList(nextFiles));
    setUploadError('');
  }

  function removeFilePreview(fileKey) {
    const remainingFiles = filePreviews
      .filter((entry) => entry.key !== fileKey)
      .map((entry) => entry.file)
      .filter(Boolean);

    syncInputFiles(remainingFiles);
    setFilePreviews((current) => current.filter((entry) => entry.key !== fileKey));
  }

  function handleDrop(event) {
    event.preventDefault();
    setDraggingFiles(false);
    const nextFiles = Array.from(event.dataTransfer.files || []);
    if (!nextFiles.length) return;

    syncInputFiles(nextFiles);
    setFilePreviews(buildFileList(nextFiles));
    setUploadError('');
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    setAuthError('');
    if (!adminUsername.trim() || !adminPassword) {
      setAuthError('Enter your admin username and password.');
      return;
    }
    if (!/^\d{6}$/.test(authenticatorCode)) {
      setAuthError('Enter the current six-digit authenticator code.');
      return;
    }

    setAuthenticating(true);
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: {
          'X-Admin-Username': adminUsername,
          'X-Admin-Password': adminPassword,
          'X-TOTP-Code': authenticatorCode,
        },
      });
      const session = await readApiResponse(response, 'Could not start the admin session.');
      setAdminAuthenticated(true);
      setSessionExpiresAt(session.expiresAt);
      lastActivityPingAt.current = Date.now();
      setAuthenticatorCode('');
      setAdminPassword('');
      await loadItems();
    } catch (loginFailure) {
      setAuthError(loginFailure.message);
    } finally {
      setAuthenticating(false);
    }
  }

  async function handleAdminLogout() {
    try {
      const response = await fetch('/api/admin/session', { method: 'DELETE' });
      await readApiResponse(response, 'Could not end the admin session.');
      setAdminAuthenticated(false);
      setSessionExpiresAt(null);
      setAuthenticatorCode('');
      setAuthError('');
    } catch (logoutFailure) {
      setAuthError(logoutFailure.message);
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = fileInputRef.current;
    const fileList = Array.from(fileInput?.files || []);

    setUploadMessage('');
    setUploadError('');
    setDeleteMessage('');

    if (!fileList.length) {
      setUploadError('Choose at least one file to upload.');
      return;
    }

    setUploading(true);
    const formData = new FormData(form);

    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        body: formData,
      });
      const result = await readApiResponse(response, 'The files could not be uploaded.');
      await loadItems();
      setUploadMessage(`${result.title} is now in the gallery.`);
      form.reset();
      if (fileInput) fileInput.value = '';
      setFilePreviews([]);
      setActiveCategory('All work');
    } catch (uploadFailure) {
      setUploadError(uploadFailure.message);
      if (uploadFailure.status === 401) {
        setAdminAuthenticated(false);
        setSessionExpiresAt(null);
        setAuthError(uploadFailure.message);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteItem(itemId) {
    try {
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
      });
      await readApiResponse(response, 'The item could not be deleted.');
      await loadItems();
      setSelectedItem(null);
      if (adminPreviewItem?.id === itemId) {
        setAdminPreviewItem(null);
        setEditingItemId(null);
      }
      setDeleteMessage('Item removed from the gallery.');
      setDeleteError('');
      setActiveCategory('All work');
    } catch (deleteFailure) {
      setDeleteError(deleteFailure.message);
      if (deleteFailure.status === 401) {
        setAdminAuthenticated(false);
        setSessionExpiresAt(null);
        setAuthError(deleteFailure.message);
      }
    }
  }

  function startEditingItem(item) {
    setAdminPreviewItem(item);
    setEditingItemId(item.id);
    setEditFields({
      title: item.title,
      year: item.year,
      description: item.description || '',
      isLocked: item.isLocked,
    });
    setEditError('');
    setEditMessage('');
  }

  async function handleSaveItem(event) {
    event.preventDefault();
    if (!adminPreviewItem) return;

    setSavingEdit(true);
    setEditError('');
    setEditMessage('');
    try {
      const response = await fetch(`/api/items/${adminPreviewItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFields),
      });
      const updatedItem = await readApiResponse(response, 'The gallery item could not be updated.');
      setItems((currentItems) => currentItems.map((item) => (
        item.id === updatedItem.id ? updatedItem : item
      )));
      setAdminPreviewItem(updatedItem);
      setEditingItemId(null);
      setEditMessage('Gallery details saved.');
    } catch (saveFailure) {
      setEditError(saveFailure.message);
      if (saveFailure.status === 401) {
        setAdminAuthenticated(false);
        setSessionExpiresAt(null);
        setAuthError(saveFailure.message);
      }
    } finally {
      setSavingEdit(false);
    }
  }

  if (isAdminRoute()) {
    return (
      <main className="admin-dashboard">
        <header className="site-header">
          <a className="wordmark" href="/" aria-label="Mira Sol home">mira<span>sol</span><i>.</i></a>
          <span className="eyebrow">Admin portal</span>
        </header>

        {!uploadEnabled ? (
          <section className="admin-panel">
            <p className="eyebrow">Admin setup required</p>
            <h1>Admin sign-in is unavailable.</h1>
            <p>Configure ADMIN_USERNAME, ADMIN_PASSWORD, and TOTP_SECRET on the server, then restart it.</p>
          </section>
        ) : !canAdminUpload ? (
          <section className="admin-panel">
            <p className="eyebrow">Restricted access</p>
            <h1>Sign in to manage the gallery.</h1>
            <p>Use your admin username, password, and current authenticator code. Your session ends after 10 minutes without activity.</p>
            <form className="upload-form admin-login-form" onSubmit={handleAdminLogin}>
              <label>
                Username
                <input
                  type="text"
                  autoComplete="username"
                  value={adminUsername}
                  onChange={(event) => setAdminUsername(event.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                Authenticator code
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={authenticatorCode}
                  onChange={(event) => setAuthenticatorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                />
              </label>
              {authError && <p className="upload-feedback error" role="alert">{authError}</p>}
              <button className="upload-submit" type="submit" disabled={authenticating}>
                {authenticating ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section className="admin-panel admin-session-bar">
              <div>
                <p className="eyebrow">Signed in</p>
                <p>Your session stays active while you use the portal and ends after 10 minutes without activity.</p>
              </div>
              <button className="upload-submit" type="button" onClick={handleAdminLogout}>Sign out</button>
              {authError && <p className="upload-feedback error" role="alert">{authError}</p>}
            </section>

            <section className="upload-section admin-content">
              <div className="upload-intro">
                <p className="eyebrow">Gallery management</p>
                <h1>Upload a new <em>piece</em>.</h1>
                <p>Upload artwork, comics, books, or other images and PDFs. Comic and book pages should be selected in reading order.</p>
              </div>

              <form className="upload-form" onSubmit={handleUpload} encType="multipart/form-data">
                <div className="upload-fields">
                  <label>
                    Title
                    <input name="title" type="text" placeholder="The Blue Hour" required />
                  </label>
                  <label>
                    Year
                    <input name="year" type="text" placeholder="2025" required />
                  </label>
                </div>
                <label>
                  Category
                  <select name="category" defaultValue="Artwork">
                    <option value="Artwork">Artwork</option>
                    <option value="Comic">Comic</option>
                    <option value="Book">Book</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="upload-checkbox">
                  <input name="locked" type="checkbox" value="true" />
                  <span>Locked — list publicly, but only admins can view the files</span>
                </label>
                <label className="upload-file-label">
                  Files
                  <div
                    className={`upload-drop-zone ${draggingFiles ? 'dragging' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDraggingFiles(true);
                    }}
                    onDragLeave={() => setDraggingFiles(false)}
                    onDrop={handleDrop}
                  >
                    <span className="upload-hint">Drag files here or choose from your device.</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      name="files"
                      multiple
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                      onChange={handleFileSelection}
                    />
                  </div>
                </label>
                <div className="upload-file-preview-list">
                  {filePreviews.map((entry) => (
                    <div className="upload-file-preview" key={entry.key}>
                      {entry.preview ? <img src={entry.preview} alt={entry.name} /> : <div className="upload-file-fallback">PDF</div>}
                      <button
                        type="button"
                        className="upload-file-remove"
                        aria-label={`Remove ${entry.name}`}
                        onClick={() => removeFilePreview(entry.key)}
                      >
                        ×
                      </button>
                      <span className="upload-file-name">{entry.name}</span>
                    </div>
                  ))}
                </div>
                <label>
                  Alt text
                  <input name="altText" type="text" placeholder="Describe the image" />
                </label>
                <label>
                  Description
                  <input name="description" type="text" placeholder="Medium, notes, or story behind the work" />
                </label>
                {uploadMessage && <p className="upload-feedback">{uploadMessage}</p>}
                {uploadError && <p className="upload-feedback error" role="alert">{uploadError}</p>}
                <button className="upload-submit" type="submit" disabled={uploading}>
                  {uploading ? 'Uploading...' : 'Upload to gallery'}
                </button>
              </form>
            </section>

            <section className="admin-panel">
              <p className="eyebrow">Current gallery</p>
              <h2>Manage uploaded work</h2>
              {deleteMessage && <p className="upload-feedback">{deleteMessage}</p>}
              {deleteError && <p className="upload-feedback error" role="alert">{deleteError}</p>}
              {editMessage && <p className="upload-feedback" role="status">{editMessage}</p>}
              <div className="admin-item-list">
                {items.map((item) => (
                  <div className="admin-item" key={item.id}>
                    <button
                      className="admin-item-preview"
                      type="button"
                      onClick={() => setAdminPreviewItem(item)}
                      aria-label={`Preview ${item.title}`}
                    >
                      {item.image ? (
                        <img src={item.image} alt="" loading="lazy" />
                      ) : (
                        <span>{item.files?.length ? 'PDF' : 'No preview'}</span>
                      )}
                    </button>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.category} · {item.year}{item.isLocked ? ' · Locked' : ''}</span>
                      <p>{item.description || 'No description'}</p>
                    </div>
                    <div className="admin-item-actions">
                      <button className="card-delete" type="button" onClick={() => startEditingItem(item)}>
                        Edit
                      </button>
                      <button className="card-delete" type="button" onClick={() => handleDeleteItem(item.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {!items.length && <p className="gallery-message">No gallery items yet.</p>}
              </div>
            </section>
            {adminPreviewItem && (
              <div className="dialog-backdrop" onClick={() => setAdminPreviewItem(null)}>
                <section
                  className="artwork-dialog admin-preview-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-preview-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="dialog-close"
                    type="button"
                    onClick={() => {
                      setAdminPreviewItem(null);
                      setEditingItemId(null);
                    }}
                    aria-label="Close preview"
                  >
                    ×
                  </button>
                  <div className="dialog-files">
                    {adminPreviewItem.files?.length ? (
                      adminPreviewItem.files.map((file) => (
                        file.mimeType === 'application/pdf' ? (
                          <iframe key={file.url} title={adminPreviewItem.title} src={file.url} />
                        ) : (
                          <img key={file.url} src={file.url} alt={adminPreviewItem.alt || adminPreviewItem.title} />
                        )
                      ))
                    ) : (
                      <img src={adminPreviewItem.image || ''} alt={adminPreviewItem.alt || adminPreviewItem.title} />
                    )}
                  </div>
                  <div className="dialog-copy">
                    <p className="eyebrow">{adminPreviewItem.category} · {adminPreviewItem.year}</p>
                    <h2 id="admin-preview-title">{adminPreviewItem.title}</h2>
                    {editingItemId === adminPreviewItem.id ? (
                      <form className="upload-form admin-edit-form" onSubmit={handleSaveItem}>
                        <label>
                          Name
                          <input
                            type="text"
                            maxLength={120}
                            value={editFields.title}
                            onChange={(event) => setEditFields((fields) => ({ ...fields, title: event.target.value }))}
                            required
                          />
                        </label>
                        <label className="upload-checkbox">
                          <input
                            type="checkbox"
                            checked={editFields.isLocked}
                            onChange={(event) => setEditFields((fields) => ({ ...fields, isLocked: event.target.checked }))}
                          />
                          <span>Locked — only admins can view the files</span>
                        </label>
                        <label>
                          Year
                          <input
                            type="text"
                            maxLength={20}
                            value={editFields.year}
                            onChange={(event) => setEditFields((fields) => ({ ...fields, year: event.target.value }))}
                            required
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            rows={5}
                            maxLength={2000}
                            value={editFields.description}
                            onChange={(event) => setEditFields((fields) => ({ ...fields, description: event.target.value }))}
                          />
                        </label>
                        {editError && <p className="upload-feedback error" role="alert">{editError}</p>}
                        <div className="admin-item-actions">
                          <button className="upload-submit" type="submit" disabled={savingEdit}>
                            {savingEdit ? 'Saving...' : 'Save changes'}
                          </button>
                          <button className="card-delete" type="button" onClick={() => setEditingItemId(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p>{adminPreviewItem.description || 'No description'}</p>
                        <button className="upload-submit" type="button" onClick={() => startEditingItem(adminPreviewItem)}>
                          Edit details
                        </button>
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    );
  }

  if (isComicsPage || isBooksPage) {
    const section = isComicsPage ? 'comics' : 'books';
    const pageItems = items.filter((item) => item.section === section);
    const pageTitle = isComicsPage ? 'Comics' : 'Books';
    return (
      <main>
        <header className="site-header">
          <a className="wordmark" href="/" aria-label="Mira Sol home">mira<span>sol</span><i>.</i></a>
          <nav className="main-nav" aria-label="Main navigation">
            <a href="/">Work</a>
            <a href="/comics" aria-current={isComicsPage ? 'page' : undefined}>Comics</a>
            <a href="/books" aria-current={isBooksPage ? 'page' : undefined}>Books</a>
            <a href="/#about">About</a>
            <a className="nav-contact" href="mailto:hello@mirasol.studio">Get in touch <span aria-hidden="true">→</span></a>
          </nav>
        </header>

        <section className="work-section library-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Mira Sol's library</p>
              <h1>{pageTitle}<span className="accent-dot">.</span></h1>
              <p className="library-intro">
                {isComicsPage
                  ? 'Browse and read the comics. Select a title to open its pages in reading order.'
                  : 'Browse books available to read as PDFs or page-by-page image collections.'}
              </p>
            </div>
            <a className="text-link" href="/">Back to work</a>
          </div>
          {loading && <p className="gallery-message" role="status">Gathering the {pageTitle.toLowerCase()}...</p>}
          {error && <p className="gallery-message" role="alert">{error}</p>}
          {!loading && !error && (
            <div className="art-grid">
              {pageItems.map((item, index) => {
                const cover = item.image || (item.files?.[0]?.mimeType?.startsWith('image/') ? item.files[0].url : '');
                return (
                  <div className="artwork-wrap" key={item.id}>
                    <button
                      className={`artwork-card ${item.shape || 'portrait'} ${item.isLocked ? 'is-locked' : ''}`}
                      type="button"
                      disabled={item.isLocked}
                      onClick={() => setSelectedItem(item)}
                      aria-label={item.isLocked ? `${item.title}, locked` : `Read ${item.title}`}
                      style={{ '--delay': `${index * 80}ms` }}
                    >
                      <span className="artwork-image-wrap">
                        {cover ? (
                          <img src={cover} alt={item.alt || item.title} loading="lazy" />
                        ) : (
                          <span className="library-placeholder" aria-hidden="true">{item.isLocked ? 'Locked' : 'PDF'}</span>
                        )}
                        {item.isLocked && <span className="lock-badge">Locked</span>}
                        {!item.isLocked && <span className="artwork-open" aria-hidden="true">↗</span>}
                      </span>
                      <span className="artwork-meta">
                        <span><strong>{item.title}</strong><small>{item.isLocked ? 'Locked' : pageTitle.slice(0, -1)}</small></span>
                        <span className="artwork-year">{item.year}</span>
                      </span>
                    </button>
                  </div>
                );
              })}
              {!pageItems.length && <p className="gallery-message">No {pageTitle.toLowerCase()} have been added yet.</p>}
            </div>
          )}
        </section>

        <footer className="site-footer">
          <a className="wordmark" href="/">mira<span>sol</span><i>.</i></a>
          <span>Independent artist & illustrator</span>
          <a href="mailto:hello@mirasol.studio">hello@mirasol.studio <span aria-hidden="true">→</span></a>
        </footer>

        {selectedItem && (
          <div className="dialog-backdrop" onClick={() => setSelectedItem(null)}>
            <section
              className="artwork-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              onClick={(event) => event.stopPropagation()}
            >
              <button className="dialog-close" type="button" onClick={() => setSelectedItem(null)} aria-label="Close reading view">×</button>
              <div className="dialog-files">
                {selectedItem.files?.length ? selectedItem.files.map((file) => (
                  file.mimeType === 'application/pdf'
                    ? <iframe key={file.url} title={selectedItem.title} src={file.url} />
                    : <img key={file.url} src={file.url} alt={selectedItem.alt || selectedItem.title} />
                )) : <img src={selectedItem.image || ''} alt={selectedItem.alt || selectedItem.title} />}
              </div>
              <div className="dialog-copy">
                <p className="eyebrow">{pageTitle} · {selectedItem.year}</p>
                <h2 id="dialog-title">{selectedItem.title}</h2>
                <p>{selectedItem.description}</p>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#home" aria-label="Mira Sol home">mira<span>sol</span><i>.</i></a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#work">Work</a>
          <a href="/comics">Comics</a>
          <a href="/books">Books</a>
          <a href="#about">About</a>
          <a className="nav-contact" href="mailto:hello@mirasol.studio">Get in touch <span aria-hidden="true">?</span></a>
        </nav>
      </header>

      <section className="hero" id="home">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> Independent artist & illustrator</p>
          <h1>Art for the<br />in-between <em>moments.</em></h1>
          <div className="hero-bottom">
            <p>Making images about memory, nature, and the small things that stay with us.</p>
            <a className="round-link" href="#work" aria-label="Explore selected work"><span aria-hidden="true">?</span></a>
          </div>
        </div>
        <div className="hero-art" role="img" aria-label="Colorful abstract painting in a sunlit studio">
          <div className="hero-art-label"><span>01 / 04</span><span>STUDIES IN COLOR, 2025</span></div>
        </div>
        <span className="hero-side-note">ARTIST PORTFOLIO <span>�</span> 2025</span>
      </section>

      <section className="work-section" id="work">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A few things I made</p>
            <h2>Selected work<span className="accent-dot">.</span></h2>
          </div>
          <span className="work-count">2024 � 2025</span>
        </div>

        <div className="filter-row" role="group" aria-label="Filter artwork by category">
          {categories.map((category) => (
            <button
              className={activeCategory === category ? 'filter-button active' : 'filter-button'}
              key={category}
              type="button"
              aria-pressed={activeCategory === category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {loading && <p className="gallery-message" role="status">Gathering the work...</p>}
        {error && <p className="gallery-message" role="alert">{error}</p>}
        {!loading && !error && (
          <div className="art-grid">
            {visibleItems.map((item, index) => (
              <div className="artwork-wrap" key={item.id}>
                <button
                  className={`artwork-card ${item.shape || 'portrait'} ${item.isLocked ? 'is-locked' : ''}`}
                  type="button"
                  disabled={item.isLocked}
                  onClick={() => setSelectedItem(item)}
                  aria-label={item.isLocked
                    ? `${item.title}, locked`
                    : `View ${item.title}, ${item.category}, ${item.year}`}
                  style={{ '--delay': `${index * 80}ms` }}
                >
                  <span className="artwork-image-wrap">
                    {item.image ? (
                      <img src={item.image} alt={item.alt || item.title} loading="lazy" />
                    ) : (
                      <span className="library-placeholder" aria-hidden="true">
                        {item.isLocked ? 'Locked' : item.files?.[0]?.mimeType === 'application/pdf' ? 'PDF' : 'No preview'}
                      </span>
                    )}
                    {item.isLocked
                      ? <span className="lock-badge">Locked</span>
                      : <span className="artwork-open" aria-hidden="true">↗</span>}
                  </span>
                  <span className="artwork-meta">
                    <span><strong>{item.title}</strong><small>{item.category}</small></span>
                    <span className="artwork-year">{item.year}</span>
                  </span>
                </button>
                {canAdminUpload && (
                  <button type="button" className="card-delete" onClick={() => handleDeleteItem(item.id)}>
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {!loading && isAdminRoute() && !uploadEnabled && (
        <section className="upload-section" id="upload">
          <div className="upload-intro">
            <p className="eyebrow">Admin setup required</p>
            <h2>Uploads are not enabled on the server.</h2>
            <p>Set the server's TOTP_SECRET environment variable, then restart the app.</p>
          </div>
        </section>
      )}

      {uploadEnabled && !canAdminUpload && (
        <section className="upload-section" id="upload">
          <div className="upload-intro">
            <p className="eyebrow">Admin access required</p>
            <h2>Sign in with your authenticator.</h2>
            <p>Enter a current six-digit code to sign in. Your session stays active while you use the portal and ends after 10 minutes without activity.</p>
          </div>
          <form className="upload-form" onSubmit={handleAdminLogin}>
            <label>
              Authenticator code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={authenticatorCode}
                onChange={(event) => setAuthenticatorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
              />
            </label>
            {authError && <p className="upload-feedback error" role="alert">{authError}</p>}
            <button className="upload-submit" type="submit" disabled={authenticating}>
              {authenticating ? 'Verifying...' : 'Sign in'}
            </button>
          </form>
        </section>
      )}

      {canAdminUpload && (
        <section className="upload-section" id="upload">
          <div className="upload-intro">
            <p className="eyebrow">Upload + archive</p>
            <h2>Share a new <em>piece</em> from the studio.</h2>
            <p>Upload stills, studies, prints, or development sheets. Accepted file types include JPG, PNG, GIF, WEBP, and PDF. Comic pages must be image files.</p>
          </div>

          <div className="upload-form">
            <p>Admin session active until {new Date(sessionExpiresAt).toLocaleTimeString()}.</p>
            <button className="upload-submit" type="button" onClick={handleAdminLogout}>
              Sign out
            </button>
            {authError && <p className="upload-feedback error" role="alert">{authError}</p>}
          </div>

          <form className="upload-form" onSubmit={handleUpload} encType="multipart/form-data">
            <div className="upload-fields">
              <label>
                Title
                <input name="title" type="text" placeholder="The Blue Hour" required />
              </label>
              <label>
                Year
                <input name="year" type="text" placeholder="2025" required />
              </label>
            </div>

            <div className="upload-fields">
              <label>
                Category
                <select name="category" defaultValue="Artwork">
                  <option value="Artwork">Artwork</option>
                  <option value="Comic">Comic</option>
                  <option value="Book">Book</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </div>
            <label className="upload-checkbox">
              <input name="locked" type="checkbox" value="true" />
              <span>Locked — list publicly, but only admins can view the files</span>
            </label>

            <label className="upload-file-label">
              Files
              <div
                className={`upload-drop-zone ${draggingFiles ? 'dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDraggingFiles(true);
                }}
                onDragLeave={() => setDraggingFiles(false)}
                onDrop={handleDrop}
              >
                <span className="upload-hint">Drag files here or choose from your device.</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  name="files"
                  multiple
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                  onChange={handleFileSelection}
                />
              </div>
            </label>

            <div className="upload-file-preview-list">
              {filePreviews.map((entry) => (
                <div className="upload-file-preview" key={entry.key}>
                  {entry.preview ? (
                    <img src={entry.preview} alt={entry.name} />
                  ) : (
                    <div className="upload-file-fallback">PDF</div>
                  )}
                  <button
                    type="button"
                    className="upload-file-remove"
                    aria-label={`Remove ${entry.name}`}
                    onClick={() => removeFilePreview(entry.key)}
                  >
                    �
                  </button>
                  <span className="upload-file-name">{entry.name}</span>
                </div>
              ))}
            </div>

            <label>
              Alt text
              <input name="altText" type="text" placeholder="Describe the image" />
            </label>

            <label>
              Description
              <input name="description" type="text" placeholder="Medium, notes, or story behind the work" />
            </label>

            {uploadMessage && <p className="upload-feedback">{uploadMessage}</p>}
            {uploadError && <p className="upload-feedback error">{uploadError}</p>}
            {deleteMessage && <p className="upload-feedback">{deleteMessage}</p>}
            {deleteError && <p className="upload-feedback error">{deleteError}</p>}

            <button className="upload-submit" type="submit" disabled={uploading || !canAdminUpload}>
              {uploading ? 'Uploading�' : 'Upload to gallery'} <span aria-hidden="true">?</span>
            </button>
          </form>
        </section>
      )}

      <section className="about-section" id="about">
        <div className="about-index">A LITTLE<br />ABOUT ME <span>?</span></div>
        <div className="about-copy">
          <p className="eyebrow">Based in Portland, Oregon</p>
          <h2>Curiosity is a<br />pretty good <em>compass.</em></h2>
          <p className="about-description">I�m Mira, an artist working across painting, print, and illustration. My practice starts with looking closely: at a landscape, a passing feeling, or the way light lands on an ordinary afternoon.</p>
          <a className="text-link" href="mailto:hello@mirasol.studio">Say hello <span aria-hidden="true">?</span></a>
        </div>
        <div className="about-mark" aria-hidden="true">m.</div>
      </section>

      <footer className="site-footer">
        <a className="wordmark" href="#home">mira<span>sol</span><i>.</i></a>
        <span>Independent artist & illustrator</span>
        <a href="mailto:hello@mirasol.studio">hello@mirasol.studio <span aria-hidden="true">?</span></a>
        <span>� 2025 Mira Sol</span>
      </footer>

      {selectedItem && (
        <div className="dialog-backdrop" onClick={() => setSelectedItem(null)}>
          <section
            className="artwork-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" onClick={() => setSelectedItem(null)} aria-label="Close artwork details">�</button>
            <div className="dialog-files">
              {selectedItem.files?.length ? (
                selectedItem.files.map((file) => (
                  file.mimeType === 'application/pdf' ? (
                    <iframe key={file.url} title={selectedItem.title} src={file.url} />
                  ) : (
                    <img key={file.url} src={file.url} alt={selectedItem.alt || selectedItem.title} />
                  )
                ))
              ) : (
                <img src={selectedItem.image || ''} alt={selectedItem.alt || selectedItem.title} />
              )}
            </div>
            <div className="dialog-copy">
              <p className="eyebrow">{selectedItem.category} <span>�</span> {selectedItem.year}</p>
              <h2 id="dialog-title">{selectedItem.title}</h2>
              <p>{selectedItem.description}</p>
              {canAdminUpload && (
                <button className="dialog-delete" type="button" onClick={() => handleDeleteItem(selectedItem.id)}>
                  Delete
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
