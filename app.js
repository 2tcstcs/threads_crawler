// Global dashboard state
let allPosts = [];
let themeVolumeChart = null;
let themeEngagementChart = null;
let hourlyTrendChart = null;
let sentimentChart = null;
let sentimentEngagementChart = null;

const RSS_MIRRORS = [
  "https://rsshub.moe",
  "https://rsshub.outv.im",
  "https://rsshub.soundoftext.app",
  "https://rss.chgsh.co",
  "https://rsshub.app" // Official fallback
];

// CSS Google-inspired colors matching index.css
const THEME_COLORS = [
  '#1a73e8', // Theme 0: Google Blue
  '#1e8e3e', // Theme 1: Google Green
  '#f9ab00', // Theme 2: Google Yellow
  '#d93025'  // Theme 3: Google Red
];
const FALLBACK_COLOR = '#5f6368'; // Google Gray

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Dark/Light Mode
  initTheme();
  
  // 2. Load Data from window.crawledData
  loadCrawledData();

  // 3. Set Up UI Event Listeners
  setupEventListeners();

  // 4. Initialize Settings Modal
  initSettings();

  // 5. Bind anomaly banner close button
  const bannerClose = document.getElementById('banner-close-btn');
  if (bannerClose) {
    bannerClose.addEventListener('click', () => {
      document.getElementById('anomaly-alert-banner').classList.add('hidden');
      window.bannerDismissed = true;
    });
  }

  // 6. Initial Render & Filter
  updateDashboard();

  // 7. Background RSS Dynamic Rescue
  rescueLiveTrends();
});

/**
 * Initialize Light/Dark theme toggling
 */
function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  
  // Check local storage or system preferences
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  }

  themeToggle.addEventListener('click', () => {
    if (document.documentElement.classList.contains('dark')) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
    // Update charts text colors if needed
    updateChartTheme();
  });
}

/**
 * Loads data from window.crawledData which is loaded from data.js
 */
function loadCrawledData() {
  if (window.crawledData && Array.isArray(window.crawledData)) {
    allPosts = window.crawledData;
    // Classify sentiment for all posts dynamically
    allPosts.forEach(post => {
      post.sentiment = classifySentiment(post.text);
    });
  } else {
    allPosts = [];
    console.warn("window.crawledData is not defined or is not an array. Using empty mock dataset.");
  }
  
  // Populate the themes checkboxes list dynamically based on loaded data
  populateThemeCheckboxes();
}

/**
 * Get all unique themes in data
 */
function getUniqueThemes() {
  const themes = new Set();
  allPosts.forEach(post => {
    if (post.theme) themes.add(post.theme);
  });
  
  // If empty, return defaults
  if (themes.size === 0) {
    return ["AI", "台股", "旅遊", "美食"];
  }
  return Array.from(themes);
}

/**
 * Helper to get theme color index
 */
function getThemeColorIndex(themeName) {
  const uniqueThemes = getUniqueThemes();
  const idx = uniqueThemes.indexOf(themeName);
  return idx >= 0 ? idx % 4 : -1;
}

/**
 * Get color string by theme
 */
function getThemeColor(themeName) {
  const idx = getThemeColorIndex(themeName);
  return idx >= 0 ? THEME_COLORS[idx] : FALLBACK_COLOR;
}

/**
 * Populate theme checkboxes list with posts count
 */
function populateThemeCheckboxes() {
  const container = document.getElementById('theme-selector-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  const uniqueThemes = getUniqueThemes();
  
  uniqueThemes.forEach(theme => {
    // Count posts for this theme in allPosts
    const themeCount = allPosts.filter(p => p.theme === theme).length;
    const colorIndex = getThemeColorIndex(theme);
    const colorClass = colorIndex >= 0 ? `theme-tag-${colorIndex}` : '';
    
    const item = document.createElement('label');
    item.className = 'theme-checkbox-item checked';
    item.dataset.theme = theme;
    
    item.innerHTML = `
      <input type="checkbox" checked value="${theme}">
      <span class="theme-badge-name">
        ${theme}
        <span class="theme-badge-count">${themeCount}</span>
      </span>
    `;
    
    // Add event listener to style when checked/unchecked
    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        item.classList.add('checked');
      } else {
        item.classList.remove('checked');
      }
      updateDashboard();
    });
    
    container.appendChild(item);
  });
}

/**
 * Setup global event listeners
 */
function setupEventListeners() {
  // Search text filter
  const searchInput = document.getElementById('filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      updateDashboard();
    }, 250));
  }

  // Minimum likes filter
  const likesInput = document.getElementById('filter-likes-min');
  if (likesInput) {
    likesInput.addEventListener('input', () => {
      updateDashboard();
    });
  }

  // Sort dropdown
  const sortSelect = document.getElementById('filter-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      updateDashboard();
    });
  }

  // Reset filters link
  const resetBtn = document.getElementById('reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearAllFilters();
    });
  }

  // Empty state reset button
  const emptyResetBtn = document.getElementById('empty-reset-btn');
  if (emptyResetBtn) {
    emptyResetBtn.addEventListener('click', () => {
      clearAllFilters();
    });
  }

  // Refresh button (reloads page to load latest data.js)
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const icon = refreshBtn.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      
      // Reload the page
      setTimeout(() => {
        window.location.reload();
      }, 500);
    });
  }

  // Sentiment Filter dropdown
  const sentimentSelect = document.getElementById('filter-sentiment');
  if (sentimentSelect) {
    sentimentSelect.addEventListener('change', () => {
      updateDashboard();
    });
  }

  // Time Preset Filter
  const timePresetSelect = document.getElementById('filter-time-preset');
  const customTimeInputs = document.getElementById('custom-time-inputs');
  if (timePresetSelect) {
    timePresetSelect.addEventListener('change', () => {
      if (timePresetSelect.value === 'custom') {
        customTimeInputs?.classList.remove('hidden');
      } else {
        customTimeInputs?.classList.add('hidden');
      }
      updateDashboard();
    });
  }

  // Custom Time Start/End Inputs
  const timeStartInput = document.getElementById('filter-time-start');
  const timeEndInput = document.getElementById('filter-time-end');

  function validateCustomTimeInputs() {
    if (timeStartInput && timeEndInput && timeStartInput.value && timeEndInput.value) {
      const startMs = new Date(timeStartInput.value).getTime();
      const endMs = new Date(timeEndInput.value).getTime();
      if (endMs < startMs) {
        timeEndInput.value = timeStartInput.value;
      }
    }
  }

  if (timeStartInput) {
    timeStartInput.addEventListener('change', () => {
      validateCustomTimeInputs();
      updateDashboard();
    });
  }

  if (timeEndInput) {
    timeEndInput.addEventListener('change', () => {
      validateCustomTimeInputs();
      updateDashboard();
    });
  }
}

/**
 * Clear all filters to default state
 */
function clearAllFilters() {
  const searchInput = document.getElementById('filter-search');
  if (searchInput) searchInput.value = '';

  const likesInput = document.getElementById('filter-likes-min');
  if (likesInput) likesInput.value = '';

  const sortSelect = document.getElementById('filter-sort');
  if (sortSelect) sortSelect.value = 'time-desc';

  const sentimentSelect = document.getElementById('filter-sentiment');
  if (sentimentSelect) sentimentSelect.value = 'all';

  const timePresetSelect = document.getElementById('filter-time-preset');
  if (timePresetSelect) timePresetSelect.value = 'all';

  const timeStart = document.getElementById('filter-time-start');
  if (timeStart) timeStart.value = '';

  const timeEnd = document.getElementById('filter-time-end');
  if (timeEnd) timeEnd.value = '';

  const customTimeInputs = document.getElementById('custom-time-inputs');
  if (customTimeInputs) customTimeInputs.classList.add('hidden');

  // Check all checkboxes
  const checkboxes = document.querySelectorAll('#theme-selector-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = true;
    cb.parentElement.classList.add('checked');
  });

  updateDashboard();
}

/**
 * Filter and sort posts based on sidebar values
 */
function getFilteredAndSortedPosts() {
  // 1. Get filter values
  const searchQuery = document.getElementById('filter-search')?.value.toLowerCase().trim() || '';
  const minLikes = parseInt(document.getElementById('filter-likes-min')?.value) || 0;
  const sortVal = document.getElementById('filter-sort')?.value || 'time-desc';
  const sentimentVal = document.getElementById('filter-sentiment')?.value || 'all';
  const timePreset = document.getElementById('filter-time-preset')?.value || 'all';
  const timeStartVal = document.getElementById('filter-time-start')?.value || '';
  const timeEndVal = document.getElementById('filter-time-end')?.value || '';
  
  // Get checked themes
  const checkedThemes = [];
  const checkboxes = document.querySelectorAll('#theme-selector-list input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb.checked) {
      checkedThemes.push(cb.value);
    }
  });

  // 2. Perform filtering
  let filtered = allPosts.filter(post => {
    // Anomaly deep dive override
    if (window.deepDiveFilter) {
      if (String(post.theme).trim() !== String(window.deepDiveFilter.theme).trim()) return false;
      if (post.time < window.deepDiveFilter.startTime) return false;
    }

    // Time filter check
    if (timePreset !== 'all') {
      let referenceNow = Math.floor(Date.now() / 1000);
      if (allPosts.length > 0) {
        const latestPostTime = Math.max(...allPosts.map(p => p.time || 0));
        if (latestPostTime > referenceNow) {
          referenceNow = latestPostTime;
        }
      }

      if (timePreset === '24h') {
        if (post.time && (referenceNow - post.time > 24 * 3600)) return false;
      } else if (timePreset === '48h') {
        if (post.time && (referenceNow - post.time > 48 * 3600)) return false;
      } else if (timePreset === '72h') {
        if (post.time && (referenceNow - post.time > 72 * 3600)) return false;
      } else if (timePreset === 'custom') {
        if (timeStartVal) {
          const startTs = Math.floor(new Date(timeStartVal).getTime() / 1000);
          if (post.time && post.time < startTs) return false;
        }
        if (timeEndVal) {
          const endTs = Math.floor(new Date(timeEndVal).getTime() / 1000);
          if (post.time && post.time > endTs) return false;
        }
      }
    }

    // Theme check (ignored in deep dive override unless manually checked)
    if (!window.deepDiveFilter && checkedThemes.length > 0 && !checkedThemes.includes(post.theme)) {
      return false;
    }
    // Min likes check
    if (post.likes < minLikes) {
      return false;
    }
    // Sentiment check
    if (sentimentVal !== 'all' && post.sentiment !== sentimentVal) {
      return false;
    }
    // Search query check (search in user, text, or theme)
    if (searchQuery) {
      const cleanQuery = searchQuery.replace('@', '');
      const matchesText = post.text && post.text.toLowerCase().includes(searchQuery);
      const matchesUser = post.username && post.username.toLowerCase().includes(cleanQuery);
      const matchesTheme = post.theme && post.theme.toLowerCase().includes(searchQuery);
      if (!matchesText && !matchesUser && !matchesTheme) {
        return false;
      }
    }
    return true;
  });

  // 3. Perform sorting
  filtered.sort((a, b) => {
    if (sortVal === 'time-desc') {
      return (b.time || 0) - (a.time || 0);
    } else if (sortVal === 'time-asc') {
      return (a.time || 0) - (b.time || 0);
    } else if (sortVal === 'likes-desc') {
      return (b.likes || 0) - (a.likes || 0);
    } else if (sortVal === 'replies-desc') {
      return (b.replies || 0) - (a.replies || 0);
    } else if (sortVal === 'text-len-desc') {
      return (b.text || '').length - (a.text || '').length;
    }
    return 0;
  });

  return filtered;
}

/**
 * Main function to update UI components, charts, and metrics
 */
function updateDashboard() {
  const filteredPosts = getFilteredAndSortedPosts();
  
  // 1. Update counter
  const filteredCountEl = document.getElementById('filtered-count');
  if (filteredCountEl) {
    filteredCountEl.textContent = filteredPosts.length;
  }

  // 2. Update Metrics Cards (Always calculated from current filtered selection)
  updateMetricsCards(filteredPosts);

  // 3. Render Chips
  renderFilterChips();

  // 4. Render Post Cards Grid
  renderPostCards(filteredPosts);

  // 5. Update Visualisation Charts
  updateCharts(filteredPosts);

  // 6. Render Influencer Leaderboard
  renderInfluencerLeaderboard(filteredPosts);

  // 7. Check Anomaly Spike Alerts
  checkAnomaly(filteredPosts);
}

/**
 * Update the Top Stats Cards
 */
function updateMetricsCards(posts) {
  const totalPostsEl = document.querySelector('#stat-total-posts .stat-value');
  const uniqueUsersEl = document.querySelector('#stat-unique-users .stat-value');
  const avgLikesEl = document.querySelector('#stat-avg-likes .stat-value');
  const avgRepliesEl = document.querySelector('#stat-avg-replies .stat-value');
  const lastUpdateEl = document.querySelector('#stat-last-update .stat-value');
  const syncTimeFooter = document.getElementById('sync-time');

  // Total count
  if (totalPostsEl) totalPostsEl.textContent = posts.length;

  // Unique users count
  const users = new Set(posts.map(p => p.username).filter(Boolean));
  if (uniqueUsersEl) uniqueUsersEl.textContent = users.size;

  // Average Likes and Replies
  let totalLikes = 0;
  let totalReplies = 0;
  posts.forEach(p => {
    totalLikes += (p.likes || 0);
    totalReplies += (p.replies || 0);
  });

  if (avgLikesEl) {
    avgLikesEl.textContent = posts.length > 0 ? (totalLikes / posts.length).toFixed(1) : '0.0';
  }
  if (avgRepliesEl) {
    avgRepliesEl.textContent = posts.length > 0 ? (totalReplies / posts.length).toFixed(1) : '0.0';
  }

  // Last update time (highest last_seen in dataset)
  if (lastUpdateEl || syncTimeFooter) {
    let latestTimestamp = 0;
    
    // Find latest time in database (either post time or last_seen)
    allPosts.forEach(p => {
      const pTime = p.last_seen || p.time || 0;
      if (pTime > latestTimestamp) latestTimestamp = pTime;
    });

    if (latestTimestamp > 0) {
      const date = new Date(latestTimestamp * 1000);
      const timeFormatted = formatDateTime(date);
      
      if (lastUpdateEl) lastUpdateEl.textContent = timeFormatted;
      if (syncTimeFooter) syncTimeFooter.textContent = timeFormatted;
    } else {
      const nowStr = formatDateTime(new Date());
      if (lastUpdateEl) lastUpdateEl.textContent = nowStr;
      if (syncTimeFooter) syncTimeFooter.textContent = nowStr;
    }
  }
}

/**
 * Format date utility
 */
function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Relative time representation
 */
function getRelativeTimeStr(unixTimestamp) {
  if (!unixTimestamp) return '未知時間';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;
  
  if (diff < 60) return '剛剛';
  if (diff < 3600) return `${Math.floor(diff / 60)}分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小時前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;
  
  const date = new Date(unixTimestamp * 1000);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Render Active Filter Chips
 */
function renderFilterChips() {
  const container = document.getElementById('active-chips');
  if (!container) return;

  container.innerHTML = '';

  const searchQuery = document.getElementById('filter-search')?.value.trim() || '';
  const minLikes = parseInt(document.getElementById('filter-likes-min')?.value) || 0;

  // Search chip
  if (searchQuery) {
    createChip(`關鍵字: "${searchQuery}"`, () => {
      document.getElementById('filter-search').value = '';
      updateDashboard();
    });
  }

  // Min likes chip
  if (minLikes > 0) {
    createChip(`讚數 ≥ ${minLikes}`, () => {
      document.getElementById('filter-likes-min').value = '';
      updateDashboard();
    });
  }

  // Sentiment chip
  const sentimentVal = document.getElementById('filter-sentiment')?.value || 'all';
  if (sentimentVal !== 'all') {
    let sText = '正面';
    if (sentimentVal === 'negative') sText = '負面';
    if (sentimentVal === 'neutral') sText = '中性';
    createChip(`情感: ${sText}`, () => {
      document.getElementById('filter-sentiment').value = 'all';
      updateDashboard();
    });
  }

  // Anomaly Deep Dive chip
  if (window.deepDiveFilter) {
    createChip(`暴衝分析: ${window.deepDiveFilter.theme} (2小時內)`, () => {
      window.deepDiveFilter = null;
      clearAllFilters();
    });
  }

  // Unchecked theme chips
  const checkboxes = document.querySelectorAll('#theme-selector-list input[type="checkbox"]');
  const uncheckedThemes = [];
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      uncheckedThemes.push(cb.value);
    }
  });

  if (uncheckedThemes.length > 0 && uncheckedThemes.length < checkboxes.length) {
    uncheckedThemes.forEach(theme => {
      createChip(`排除: ${theme}`, () => {
        const checkbox = Array.from(checkboxes).find(cb => cb.value === theme);
        if (checkbox) {
          checkbox.checked = true;
          checkbox.parentElement.classList.add('checked');
          updateDashboard();
        }
      });
    });
  }

  function createChip(text, onRemove) {
    const chip = document.createElement('div');
    chip.className = 'filter-chip';
    chip.innerHTML = `${text} <i class="fa-solid fa-xmark"></i>`;
    chip.querySelector('i').addEventListener('click', onRemove);
    container.appendChild(chip);
  }
}

/**
 * Render Post Cards in Grid
 */
function renderPostCards(posts) {
  const grid = document.getElementById('listings-grid');
  const emptyState = document.getElementById('empty-state');
  
  if (!grid) return;

  grid.innerHTML = '';

  if (posts.length === 0) {
    grid.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');

  posts.forEach(post => {
    const colorIndex = getThemeColorIndex(post.theme);
    const themeClass = colorIndex >= 0 ? `theme-tag-${colorIndex}` : '';
    
    // User avatar character
    const avatarChar = post.username ? post.username.substring(0, 2).toUpperCase() : '?';
    
    // Relative time description
    const relativeTime = getRelativeTimeStr(post.time);
    
    // Format text with paragraph breaks and handle clickable links if we want
    const cleanText = escapeHTML(post.text);
    
    const card = document.createElement('div');
    card.className = `post-card ${themeClass}`;

    // Sentiment badge logic
    let sentimentClass = 'sentiment-neutral';
    let sentimentText = '中性';
    if (post.sentiment === 'positive') {
      sentimentClass = 'sentiment-positive';
      sentimentText = '正面';
    } else if (post.sentiment === 'negative') {
      sentimentClass = 'sentiment-negative';
      sentimentText = '負面';
    }
    
    card.innerHTML = `
      <div class="card-header">
        <div class="card-user-info">
          <div class="user-avatar">${avatarChar}</div>
          <div class="user-details">
            <a href="${post.user_url || '#'}" target="_blank" rel="noopener noreferrer" class="username-link">
              @${post.username || 'anonymous'}
            </a>
            <a href="${post.url || '#'}" target="_blank" rel="noopener noreferrer" class="post-time-link" title="檢視原文">
              ${relativeTime} · <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i>
            </a>
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
          <span class="sentiment-badge ${sentimentClass}">${sentimentText}</span>
          <span class="theme-badge ${themeClass}">${post.theme || '預設'}</span>
        </div>
      </div>
      
      <div class="card-body">
        <p class="post-text">${cleanText}</p>
      </div>
      
      <div class="card-footer">
        <div class="engagement-metrics">
          <span class="metric-item likes" title="按讚數">
            <i class="fa-solid fa-heart"></i>
            <span class="metric-value">${formatCount(post.likes || 0)}</span>
          </span>
          <span class="metric-item replies" title="回覆數">
            <i class="fa-solid fa-comment"></i>
            <span class="metric-value">${formatCount(post.replies || 0)}</span>
          </span>
        </div>
        <a href="${post.url || '#'}" target="_blank" rel="noopener noreferrer" class="post-action-btn">
          閱讀完整對話 <i class="fa-solid fa-chevron-right"></i>
        </a>
      </div>
    `;
    
    grid.appendChild(card);
  });
}

/**
 * Format numbers for visual compactness (e.g. 1.2k)
 */
function formatCount(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Initialize / update Chart.js Visuals
 */
function updateCharts(filteredPosts) {
  // Extract theme list and compute stats
  const uniqueThemes = getUniqueThemes();
  
  // Theme Volume (Post Counts)
  const volumeData = uniqueThemes.map(theme => {
    return filteredPosts.filter(p => {
      // Clean up string comparison for theme
      return String(p.theme).trim() === String(theme).trim();
    }).length;
  });

  // Theme Engagement (Averages)
  const engagementLabels = uniqueThemes;
  const avgLikesData = uniqueThemes.map(theme => {
    const themePosts = filteredPosts.filter(p => String(p.theme).trim() === String(theme).trim());
    if (themePosts.length === 0) return 0;
    const totalLikes = themePosts.reduce((sum, p) => sum + (p.likes || 0), 0);
    return Math.round(totalLikes / themePosts.length * 10) / 10;
  });

  const avgRepliesData = uniqueThemes.map(theme => {
    const themePosts = filteredPosts.filter(p => String(p.theme).trim() === String(theme).trim());
    if (themePosts.length === 0) return 0;
    const totalReplies = themePosts.reduce((sum, p) => sum + (p.replies || 0), 0);
    return Math.round(totalReplies / themePosts.length * 10) / 10;
  });

  const themeBorderColors = uniqueThemes.map(theme => getThemeColor(theme));
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#9aa0a6' : '#5f6368';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // 1. Theme Volume Chart (Doughnut)
  const volCtx = document.getElementById('themeVolumeChart')?.getContext('2d');
  if (volCtx) {
    if (themeVolumeChart) {
      themeVolumeChart.destroy();
    }
    
    // Check if there is data
    const hasData = volumeData.some(v => v > 0);

    themeVolumeChart = new Chart(volCtx, {
      type: 'doughnut',
      data: {
        labels: uniqueThemes,
        datasets: [{
          data: hasData ? volumeData : [1],
          backgroundColor: hasData ? themeBorderColors : ['#e0e0e0'],
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? '#1f1f1f' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: textColor,
              font: {
                family: 'Roboto',
                size: 11,
                weight: '500'
              },
              boxWidth: 12
            }
          },
          tooltip: {
            enabled: hasData,
            callbacks: {
              label: function(context) {
                const val = context.raw;
                const total = context.dataset.data.reduce((a,b) => a+b, 0);
                const percentage = Math.round((val / total) * 100);
                return ` ${context.label}: ${val} 篇 (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // 2. Theme Engagement Chart (Side-by-side Bars)
  const engCtx = document.getElementById('themeEngagementChart')?.getContext('2d');
  if (engCtx) {
    if (themeEngagementChart) {
      themeEngagementChart.destroy();
    }

    themeEngagementChart = new Chart(engCtx, {
      type: 'bar',
      data: {
        labels: engagementLabels,
        datasets: [
          {
            label: '平均按讚數',
            data: avgLikesData,
            backgroundColor: '#ea4335',
            borderRadius: 4,
            barThickness: 16
          },
          {
            label: '平均回覆數',
            data: avgRepliesData,
            backgroundColor: '#1a73e8',
            borderRadius: 4,
            barThickness: 16
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: {
                family: 'Roboto',
                size: 11
              },
              boxWidth: 12
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Roboto', size: 11, weight: '500' }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Roboto', size: 10 }
            }
          }
        }
      }
    });
  }

  // 3. Hourly Trend Chart (24-Hour Line Chart)
  const hourlyCtx = document.getElementById('hourlyTrendChart')?.getContext('2d');
  if (hourlyCtx) {
    if (hourlyTrendChart) {
      hourlyTrendChart.destroy();
    }

    // Determine the anchor timestamp (latest post timestamp in dataset, or fallback to current time)
    let anchorTime = Math.floor(Date.now() / 1000);
    let latestPostTime = 0;
    filteredPosts.forEach(p => {
      if (p.time && p.time > latestPostTime) {
        latestPostTime = p.time;
      }
    });
    if (latestPostTime > 0) {
      anchorTime = latestPostTime;
    }

    // Generate labels for the last 24 hours relative to anchorTime (e.g. 17:00, 18:00...)
    const labels = [];
    const anchorDate = new Date(anchorTime * 1000);
    for (let i = 23; i >= 0; i--) {
      const d = new Date(anchorDate.getTime() - i * 3600 * 1000);
      const hoursStr = String(d.getHours()).padStart(2, '0');
      labels.push(`${hoursStr}:00`);
    }

    // Aggregate post counts per theme into 1-hour interval bins
    const lineDatasets = uniqueThemes.map(theme => {
      const counts = [];
      const themeColor = getThemeColor(theme);
      
      for (let i = 23; i >= 0; i--) {
        const binStart = anchorTime - (i + 1) * 3600;
        const binEnd = anchorTime - i * 3600;
        
        // Count posts published in this hour block for this theme
        const count = filteredPosts.filter(p => {
          return String(p.theme).trim() === String(theme).trim() && p.time >= binStart && p.time < binEnd;
        }).length;
        
        counts.push(count);
      }

      return {
        label: theme,
        data: counts,
        borderColor: themeColor,
        backgroundColor: themeColor + '10', // 6% opacity fill
        borderWidth: 2,
        tension: 0.35, // Smooth curves
        fill: true,
        pointBackgroundColor: themeColor,
        pointBorderColor: isDark ? '#1f1f1f' : '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: 3,
        pointHoverRadius: 5
      };
    });

    hourlyTrendChart = new Chart(hourlyCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: lineDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: {
                family: 'Roboto',
                size: 11
              },
              boxWidth: 12
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Roboto', size: 10 }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              stepSize: 1,
              font: { family: 'Roboto', size: 10 }
            },
            min: 0
          }
        }
      }
    });
  }

  // Render the Hourly Crawled List Table
  renderHourlyCrawlList(filteredPosts);

  // Render Sentiment Breakdown Chart
  const positiveCount = filteredPosts.filter(p => p.sentiment === 'positive').length;
  const negativeCount = filteredPosts.filter(p => p.sentiment === 'negative').length;
  const neutralCount = filteredPosts.filter(p => p.sentiment === 'neutral').length;
  const sentimentData = [positiveCount, negativeCount, neutralCount];
  const hasSentimentData = positiveCount > 0 || negativeCount > 0 || neutralCount > 0;

  const sentCtx = document.getElementById('sentimentChart')?.getContext('2d');
  if (sentCtx) {
    if (sentimentChart) {
      sentimentChart.destroy();
    }
    
    const sColors = ['var(--theme-1)', 'var(--theme-3)', 'var(--theme-fallback)'];

    sentimentChart = new Chart(sentCtx, {
      type: 'doughnut',
      data: {
        labels: ['正面', '負面', '中性'],
        datasets: [{
          data: hasSentimentData ? sentimentData : [1],
          backgroundColor: hasSentimentData ? sColors : ['#e0e0e0'],
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? '#1f1f1f' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: textColor,
              font: { family: 'Roboto', size: 11, weight: '500' },
              boxWidth: 12
            }
          },
          tooltip: {
            enabled: hasSentimentData,
            callbacks: {
              label: function(context) {
                const val = context.raw;
                const total = context.dataset.data.reduce((a,b) => a+b, 0);
                const percentage = Math.round((val / total) * 100);
                return ` ${context.label}: ${val} 篇 (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Render Sentiment Engagement Chart (Side-by-side Bars)
  const sentEngCtx = document.getElementById('sentimentEngagementChart')?.getContext('2d');
  if (sentEngCtx) {
    if (sentimentEngagementChart) {
      sentimentEngagementChart.destroy();
    }

    const sentimentCategories = ['positive', 'negative', 'neutral'];
    const avgSentimentLikesData = sentimentCategories.map(sent => {
      const sentPosts = filteredPosts.filter(p => p.sentiment === sent);
      if (sentPosts.length === 0) return 0;
      const totalLikes = sentPosts.reduce((sum, p) => sum + (p.likes || 0), 0);
      return Math.round(totalLikes / sentPosts.length * 10) / 10;
    });

    const avgSentimentRepliesData = sentimentCategories.map(sent => {
      const sentPosts = filteredPosts.filter(p => p.sentiment === sent);
      if (sentPosts.length === 0) return 0;
      const totalReplies = sentPosts.reduce((sum, p) => sum + (p.replies || 0), 0);
      return Math.round(totalReplies / sentPosts.length * 10) / 10;
    });

    sentimentEngagementChart = new Chart(sentEngCtx, {
      type: 'bar',
      data: {
        labels: ['正面', '負面', '中性'],
        datasets: [
          {
            label: '平均按讚數',
            data: avgSentimentLikesData,
            backgroundColor: '#ea4335',
            borderRadius: 4,
            barThickness: 16
          },
          {
            label: '平均回覆數',
            data: avgSentimentRepliesData,
            backgroundColor: '#1a73e8',
            borderRadius: 4,
            barThickness: 16
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: {
                family: 'Roboto',
                size: 11
              },
              boxWidth: 12
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Roboto', size: 11, weight: '500' }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Roboto', size: 10 }
            }
          }
        }
      }
    });
  }

  // Render the Word Cloud tags
  const keywords = extractKeywords(filteredPosts);
  renderWordCloud(keywords);
}

/**
 * Classify a post's sentiment based on local dictionary keywords
 */
function classifySentiment(text) {
  if (!text) return 'neutral';
  
  const positiveWords = ["推", "好用", "厲害", "讚", "多軍", "看好"];
  const negativeWords = ["雷", "難用", "爛", "傻眼", "災情", "空軍", "慘"];
  
  let score = 0;
  const lowerText = text.toLowerCase();
  
  positiveWords.forEach(w => {
    const escaped = w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const matches = lowerText.match(new RegExp(escaped, 'g'));
    if (matches) {
      score += matches.length;
    }
  });
  
  negativeWords.forEach(w => {
    const escaped = w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const matches = lowerText.match(new RegExp(escaped, 'g'));
    if (matches) {
      score -= matches.length;
    }
  });
  
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

/**
 * Rank accounts and render the top KOL list
 */
function renderInfluencerLeaderboard(posts) {
  const container = document.getElementById('top-voices-list');
  if (!container) return;

  if (posts.length === 0) {
    container.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:12px;">暫無意見領袖數據</div>';
    return;
  }

  // Aggregate stats per user
  const userStats = {};
  posts.forEach(post => {
    const username = post.username;
    if (!username || username === 'unknown') return;

    if (!userStats[username]) {
      userStats[username] = {
        username: username,
        postCount: 0,
        likes: 0,
        replies: 0
      };
    }
    userStats[username].postCount += 1;
    userStats[username].likes += (post.likes || 0);
    userStats[username].replies += (post.replies || 0);
  });

  // Calculate Engagement Score: Likes * 1 + Replies * 2
  const leaders = Object.values(userStats).map(user => {
    const score = (user.likes * 1) + (user.replies * 2);
    return {
      username: user.username,
      postCount: user.postCount,
      score: score
    };
  });

  // Sort by score descending, then postCount descending
  leaders.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.postCount - a.postCount;
  });

  // Get Top 5
  const top5 = leaders.slice(0, 5);

  if (top5.length === 0) {
    container.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:12px;">暫無意見領袖數據</div>';
    return;
  }

  container.innerHTML = '';
  top5.forEach(leader => {
    const avatarChar = leader.username.substring(0, 2).toUpperCase();
    const div = document.createElement('div');
    div.className = 'voice-leader-item';
    
    div.innerHTML = `
      <div class="voice-leader-details">
        <div class="user-avatar" style="width: 26px; height: 26px; font-size: 0.72rem; flex-shrink: 0;">${avatarChar}</div>
        <div class="voice-leader-meta">
          <span class="voice-leader-name">@${escapeHTML(leader.username)}</span>
          <span class="voice-leader-count">發文數量: ${leader.postCount} 篇</span>
        </div>
      </div>
      <span class="voice-leader-score-badge" title="社群影響力分數 = 讚數*1 + 回覆數*2">
        影響力: ${formatCount(leader.score)}
      </span>
    `;

    // Click handler to filter feed by this user
    div.onclick = () => {
      const searchInput = document.getElementById('filter-search');
      if (searchInput) {
        searchInput.value = `@${leader.username}`;
        updateDashboard();
        // Scroll to feed
        document.querySelector('.main-content').scrollIntoView({ behavior: 'smooth' });
      }
    };

    container.appendChild(div);
  });
}

/**
 * Run hourly volume statistical spike detection
 */
function checkAnomaly(posts) {
  // If user dismissed the banner, do not show it again during this session
  if (window.bannerDismissed) return;

  const uniqueThemes = getUniqueThemes();
  const banner = document.getElementById('anomaly-alert-banner');
  const bannerText = banner?.querySelector('.banner-text');
  const deepDiveBtn = document.getElementById('banner-action-btn');
  
  if (!banner || !bannerText) return;

  // Find latest timestamp as anchor
  let anchorTime = Math.floor(Date.now() / 1000);
  let latestPostTime = 0;
  posts.forEach(p => {
    if (p.time && p.time > latestPostTime) {
      latestPostTime = p.time;
    }
  });
  if (latestPostTime > 0) {
    anchorTime = latestPostTime;
  }

  let detectedAnomaly = null;
  let maxSurgePct = 0;

  uniqueThemes.forEach(theme => {
    const hourlyCounts = [];
    
    // Get hourly counts for the last 24 hours
    for (let i = 23; i >= 0; i--) {
      const binStart = anchorTime - (i + 1) * 3600;
      const binEnd = anchorTime - i * 3600;
      
      const count = posts.filter(p => {
        return String(p.theme).trim() === String(theme).trim() && p.time >= binStart && p.time < binEnd;
      }).length;
      
      hourlyCounts.push(count);
    }
    
    // The current hour is the last element
    const currentCount = hourlyCounts[23];
    
    // Calculate mean and standard deviation of the previous 23 hours
    const prevCounts = hourlyCounts.slice(0, 23);
    const sum = prevCounts.reduce((a, b) => a + b, 0);
    const mean = sum / 23;
    
    const variance = prevCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 23;
    const stdDev = Math.sqrt(variance);
    
    // Anomaly threshold: Mean + 1.5 * StdDev
    const threshold = mean + 1.5 * stdDev;
    
    // To prevent false alerts on low counts, require current hour count >= 3
    if (currentCount >= 3 && currentCount > threshold) {
      const surgePct = Math.round(((currentCount - mean) / (mean || 1)) * 100);
      if (surgePct > maxSurgePct) {
        maxSurgePct = surgePct;
        detectedAnomaly = {
          theme: theme,
          surgePct: surgePct,
          currentCount: currentCount,
          mean: mean.toFixed(1),
          anchorTime: anchorTime
        };
      }
    }
  });

  if (detectedAnomaly) {
    banner.classList.remove('hidden');
    bannerText.innerHTML = `⚠️ <strong>輿情暴衝警示：</strong>監測主題 <strong>[${escapeHTML(detectedAnomaly.theme)}]</strong> 於最近一小時的發文數量暴增了 <strong>${detectedAnomaly.surgePct}%</strong> (現有 ${detectedAnomaly.currentCount} 篇，歷史均值 ${detectedAnomaly.mean} 篇)！`;
    
    if (deepDiveBtn) {
      deepDiveBtn.onclick = () => {
        // 1. Check only the anomaly theme
        const checkboxes = document.querySelectorAll('#theme-selector-list input[type="checkbox"]');
        checkboxes.forEach(cb => {
          if (cb.value === detectedAnomaly.theme) {
            cb.checked = true;
            cb.parentElement.classList.add('checked');
          } else {
            cb.checked = false;
            cb.parentElement.classList.remove('checked');
          }
        });
        
        // 2. Clear search keyword input
        const searchInput = document.getElementById('filter-search');
        if (searchInput) searchInput.value = '';

        // 3. Set global deep dive filter: focus on anomaly theme and within last 2 hours (7200 seconds)
        window.deepDiveFilter = {
          theme: detectedAnomaly.theme,
          startTime: detectedAnomaly.anchorTime - 7200
        };

        // 4. Update the dashboard
        updateDashboard();
        
        // Scroll main container to top
        document.querySelector('.main-content').scrollIntoView({ behavior: 'smooth' });
      };
    }
  } else {
    banner.classList.add('hidden');
  }
}

/**
 * Extract 2-to-4 character phrases from raw text for word cloud representation
 */
function extractKeywords(posts) {
  // Common Chinese/English stop words to clean token list
  const stopWords = new Set([
    "的", "了", "在", "我", "你", "是", "有", "不", "人", "都", "一", "他", "她", "就", "也", "會", "和", 
    "這", "要", "對", "來", "去", "與", "及", "等", "但", "而", "跟", "那", "著", "給", "自", "由", "至", 
    "於", "以", "因此", "所以", "但是", "然而", "如果", "雖然", "而且", "並且", "我們", "你們", "他們", 
    "這個", "那個", "這些", "那些", "可以", "一個", "什麼", "覺得", "自己", "今天", "現在", "知道", 
    "因為", "非常", "真的", "已經", "Threads", "threads", "post", "posts", "看", "說", "想", "做", "很"
  ]);
  
  const freq = {};
  
  posts.forEach(post => {
    const text = post.text || "";
    // Replace non-alphanumeric and non-Chinese chars with spaces
    const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ");
    const segments = cleaned.split(/\s+/);
    
    segments.forEach(seg => {
      if (!seg) return;
      
      // Handle English words
      if (/^[a-zA-Z0-9]+$/.test(seg)) {
        const lower = seg.toLowerCase();
        // Keep English tokens between 2 and 15 letters (exclude pure numbers)
        if (lower.length >= 2 && lower.length <= 15 && !stopWords.has(lower) && !/^\d+$/.test(lower)) {
          freq[lower] = (freq[lower] || 0) + 1;
        }
      } else {
        // Generate n-grams (2 to 4 Chinese characters)
        for (let len = 2; len <= 4; len++) {
          for (let i = 0; i <= seg.length - len; i++) {
            const gram = seg.substring(i, i + len);
            // Skip n-grams containing digits or standard stop words
            if (!stopWords.has(gram) && !/\d/.test(gram)) {
              freq[gram] = (freq[gram] || 0) + 1;
            }
          }
        }
      }
    });
  });

  // Sort tags by frequency
  const sorted = Object.entries(freq)
    .map(([text, count]) => ({ text, count }))
    .filter(item => item.count >= 2) // keep recurring terms
    .sort((a, b) => b.count - a.count);

  return sorted.slice(0, 20); // Return Top 20 tags
}

/**
 * Render the HTML-based word cloud dynamically
 */
function renderWordCloud(keywords) {
  const container = document.getElementById('word-cloud-container');
  if (!container) return;

  if (keywords.length === 0) {
    container.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:48px;">暫無字雲數據</div>';
    return;
  }

  // Scaling limits
  const counts = keywords.map(k => k.count);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const range = maxCount - minCount || 1;

  container.innerHTML = '';

  // Google Material 3 themed colors
  const colors = [
    'var(--theme-0)', // Blue
    'var(--theme-1)', // Green
    '#f9ab00',        // Yellow
    'var(--theme-3)', // Red
    '#a142f4',        // Purple
    '#00acc1',        // Cyan
    '#e91e63'         // Pink
  ];

  keywords.forEach((item, idx) => {
    // Font scale between 0.8rem and 1.8rem
    const size = 0.8 + ((item.count - minCount) / range) * 1.0;
    const tag = document.createElement('span');
    tag.className = 'word-cloud-tag';
    tag.style.fontSize = `${size}rem`;
    tag.style.color = colors[idx % colors.length];
    tag.style.fontWeight = item.count === maxCount ? '700' : '500';
    tag.style.cursor = 'pointer';
    tag.textContent = item.text;
    tag.title = `出現頻率: ${item.count} 次`;

    // Click handler to trigger keyword search
    tag.onclick = () => {
      const searchInput = document.getElementById('filter-search');
      if (searchInput) {
        searchInput.value = item.text;
        updateDashboard();
        // Scroll to feed
        document.querySelector('.main-content').scrollIntoView({ behavior: 'smooth' });
      }
    };

    container.appendChild(tag);
  });
}

/**
 * Render the Hourly Crawled List Table and bind details selection
 */
function renderHourlyCrawlList(filteredPosts) {
  const tableHeader = document.getElementById('hourly-table-header');
  const tableBody = document.getElementById('hourly-table-body');
  const detailContainer = document.getElementById('hourly-detail-container');
  const detailTitle = document.getElementById('hourly-detail-title');
  const detailList = document.getElementById('hourly-detail-list');
  const detailClose = document.getElementById('hourly-detail-close');
  
  if (!tableHeader || !tableBody) return;
  
  // Close details initially or on request
  if (detailClose) {
    detailClose.onclick = () => {
      detailContainer.classList.add('hidden');
    };
  }

  // Get active themes from unique themes
  const uniqueThemes = getUniqueThemes();
  
  // Create headers: "時段" + each theme
  let headerHtml = '<th>時段</th>';
  uniqueThemes.forEach(theme => {
    headerHtml += `<th>${escapeHTML(theme)}</th>`;
  });
  tableHeader.innerHTML = headerHtml;

  // Determine the anchor timestamp (latest post timestamp, or fallback to current time)
  let anchorTime = Math.floor(Date.now() / 1000);
  let latestPostTime = 0;
  filteredPosts.forEach(p => {
    if (p.time && p.time > latestPostTime) {
      latestPostTime = p.time;
    }
  });
  if (latestPostTime > 0) {
    anchorTime = latestPostTime;
  }

  // Generate rows for the last 24 hours
  let bodyHtml = '';
  const rowsData = []; // Store cell data for click handlers

  for (let i = 0; i < 24; i++) {
    // Current hour block definition
    const binStart = anchorTime - (i + 1) * 3600;
    const binEnd = anchorTime - i * 3600;

    // Row label (hour range, e.g. "18:00 - 19:00" in local time)
    const startDate = new Date(binStart * 1000);
    const endDate = new Date(binEnd * 1000);
    const timeLabel = `${String(startDate.getHours()).padStart(2, '0')}:00 - ${String(endDate.getHours()).padStart(2, '0')}:00`;

    bodyHtml += `<tr><td>${timeLabel}</td>`;

    uniqueThemes.forEach((theme, themeIdx) => {
      // Find posts in this hour block for this theme
      const cellPosts = filteredPosts.filter(p => {
        return String(p.theme).trim() === String(theme).trim() && p.time >= binStart && p.time < binEnd;
      });

      const cellId = `cell-${i}-${themeIdx}`;
      rowsData.push({
        id: cellId,
        theme: theme,
        timeLabel: timeLabel,
        posts: cellPosts
      });

      if (cellPosts.length > 0) {
        bodyHtml += `<td><span class="hourly-cell-clickable" id="${cellId}">${cellPosts.length} 篇</span></td>`;
      } else {
        bodyHtml += `<td class="hourly-cell-empty">-</td>`;
      }
    });

    bodyHtml += `</tr>`;
  }
  
  tableBody.innerHTML = bodyHtml;

  // Bind click handlers to clickable cells
  rowsData.forEach(cell => {
    const el = document.getElementById(cell.id);
    if (!el) return;

    el.onclick = () => {
      // Show details
      detailContainer.classList.remove('hidden');
      detailTitle.innerHTML = `<i class="fa-solid fa-clock"></i> ${cell.timeLabel} 時段 [${escapeHTML(cell.theme)}] 爬取文章 (${cell.posts.length} 篇)`;

      // Render posts
      let detailHtml = '';
      cell.posts.forEach(post => {
        const relativeTime = getRelativeTimeStr(post.time);
        detailHtml += `
          <div class="hourly-post-item">
            <div class="hourly-post-item-header">
              <a href="${post.user_url || '#'}" target="_blank" class="hourly-post-item-author">@${escapeHTML(post.username || 'anonymous')}</a>
              <span>${relativeTime}</span>
            </div>
            <div class="hourly-post-item-text">${escapeHTML(post.text)}</div>
            <div class="hourly-post-item-footer">
              <div class="hourly-post-item-metrics">
                <span><i class="fa-solid fa-heart"></i> ${formatCount(post.likes || 0)}</span>
                <span><i class="fa-solid fa-comment"></i> ${formatCount(post.replies || 0)}</span>
              </div>
              <a href="${post.url || '#'}" target="_blank" class="hourly-post-item-link">
                閱讀對話 <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
            </div>
          </div>
        `;
      });
      detailList.innerHTML = detailHtml;

      // Scroll into view
      detailContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
}


/**
 * Handle updating chart text colors when toggling dark mode
 */
function updateChartTheme() {
  if (allPosts.length > 0) {
    updateCharts(getFilteredAndSortedPosts());
  }
}

/**
 * Debounce helper
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Initialize Settings Modal & Keyword Generator
 */
let currentConfig = { themes: {}, scrolls: 2, only_today: false };

function initSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('settings-close-btn');
  const saveCloseBtn = document.getElementById('settings-save-close-btn');
  const addRowBtn = document.getElementById('add-theme-row-btn');
  const copyBtn = document.getElementById('copy-json-btn');
  
  if (!settingsBtn || !settingsModal) return;

  // Open modal
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    loadConfigFromSource();
  });

  // Close modal
  const closeModal = () => {
    settingsModal.classList.add('hidden');
  };
  closeBtn.addEventListener('click', closeModal);
  saveCloseBtn.addEventListener('click', closeModal);

  // Close modal when clicking outside content
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeModal();
    }
  });

  // Add theme row
  addRowBtn.addEventListener('click', () => {
    addThemeRow('', '');
  });

  // Handle only_today checkbox toggle
  const onlyTodayCheckbox = document.getElementById('setting-only-today');
  if (onlyTodayCheckbox) {
    onlyTodayCheckbox.addEventListener('change', () => {
      currentConfig.only_today = onlyTodayCheckbox.checked;
      updateJsonPreview();
    });
  }

  // Copy JSON content
  copyBtn.addEventListener('click', () => {
    const codeBlock = document.getElementById('json-preview-code');
    if (!codeBlock) return;
    
    navigator.clipboard.writeText(codeBlock.textContent)
      .then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已複製！';
        copyBtn.style.backgroundColor = '#1e8e3e';
        copyBtn.style.color = '#ffffff';
        copyBtn.style.borderColor = '#1e8e3e';
        
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.style.backgroundColor = '';
          copyBtn.style.color = '';
          copyBtn.style.borderColor = '';
        }, 2000);
      })
      .catch(err => {
        console.error('Failed to copy: ', err);
        alert('複製失敗，請手動選取複製');
      });
  });
}

/**
 * Load settings config from config.json if served, else fallback to unique themes
 */
function loadConfigFromSource() {
  fetch('config.json')
    .then(response => {
      if (!response.ok) throw new Error('Network response not ok');
      return response.json();
    })
    .then(data => {
      if (data) {
        currentConfig.scrolls = data.scrolls || 2;
        currentConfig.only_today = data.only_today === true;
        if (data.themes) {
          if (typeof data.themes === 'object' && !Array.isArray(data.themes)) {
            currentConfig.themes = data.themes;
          } else if (Array.isArray(data.themes)) {
            currentConfig.themes = {};
            data.themes.forEach(t => {
              if (typeof t === 'string') {
                currentConfig.themes[t] = t;
              } else if (typeof t === 'object' && t.name && t.query) {
                currentConfig.themes[t.name] = t.query;
              }
            });
          }
        }
      }
      
      // Update checkbox element UI
      const onlyTodayCheckbox = document.getElementById('setting-only-today');
      if (onlyTodayCheckbox) {
        onlyTodayCheckbox.checked = currentConfig.only_today;
      }
      
      renderThemeEditor();
    })
    .catch(err => {
      console.warn('Could not fetch config.json directly (might be running offline or local file). Building configuration from crawled data.', err);
      // Fallback: extract from posts
      const uniqueThemes = getUniqueThemes();
      currentConfig.themes = {};
      currentConfig.only_today = false;
      uniqueThemes.forEach(t => {
        currentConfig.themes[t] = t;
      });
      
      const onlyTodayCheckbox = document.getElementById('setting-only-today');
      if (onlyTodayCheckbox) {
        onlyTodayCheckbox.checked = false;
      }
      
      renderThemeEditor();
    });
}

/**
 * Render all rows in the editor based on currentConfig.themes
 */
function renderThemeEditor() {
  const container = document.getElementById('theme-editor-rows');
  if (!container) return;
  
  container.innerHTML = '';
  
  const themeEntries = Object.entries(currentConfig.themes);
  if (themeEntries.length === 0) {
    // Add one empty row if empty
    addThemeRow('', '');
  } else {
    themeEntries.forEach(([name, query]) => {
      addThemeRow(name, query);
    });
  }
  
  updateJsonPreview();
}

/**
 * Add a single theme input row to the editor
 */
function addThemeRow(name = '', query = '') {
  const container = document.getElementById('theme-editor-rows');
  if (!container) return;

  const tr = document.createElement('tr');
  
  tr.innerHTML = `
    <td>
      <input type="text" class="theme-editor-input theme-name-input" placeholder="主題名稱 (例如: 台股)" value="${escapeHTML(name)}">
    </td>
    <td>
      <input type="text" class="theme-editor-input theme-query-input" placeholder="搜尋關鍵字 (例如: 台股 OR 2330)" value="${escapeHTML(query)}">
    </td>
    <td>
      <button class="delete-row-btn" title="刪除此主題">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </td>
  `;

  // Attach dynamic change events
  const nameInput = tr.querySelector('.theme-name-input');
  const queryInput = tr.querySelector('.theme-query-input');
  const deleteBtn = tr.querySelector('.delete-row-btn');

  const onInputChange = () => {
    rebuildConfigFromInputs();
  };

  nameInput.addEventListener('input', onInputChange);
  queryInput.addEventListener('input', onInputChange);

  deleteBtn.addEventListener('click', () => {
    tr.remove();
    rebuildConfigFromInputs();
  });

  container.appendChild(tr);
  rebuildConfigFromInputs();
}

/**
 * Reads values from editor rows and rebuilds currentConfig.themes
 */
function rebuildConfigFromInputs() {
  const rows = document.querySelectorAll('#theme-editor-rows tr');
  currentConfig.themes = {};
  
  rows.forEach(row => {
    const name = row.querySelector('.theme-name-input')?.value.trim();
    const query = row.querySelector('.theme-query-input')?.value.trim();
    
    if (name) {
      currentConfig.themes[name] = query || name;
    }
  });
  
  updateJsonPreview();
}

/**
 * Serializes currentConfig into the codeblock
 */
function updateJsonPreview() {
  const codeBlock = document.getElementById('json-preview-code');
  if (!codeBlock) return;
  
  const configOutput = {
    themes: currentConfig.themes,
    scrolls: currentConfig.scrolls || 2,
    only_today: currentConfig.only_today === true
  };
  
  codeBlock.textContent = JSON.stringify(configOutput, null, 2);
}

/**
 * Shuffles mirror nodes and fetches live Threads post trends via RSS-Hub mirrors.
 * Performs failover rotation and merges results safely into global state.
 */
async function fetchLiveTrends(keyword) {
  const shuffledMirrors = [...RSS_MIRRORS].sort(() => Math.random() - 0.5);
  
  for (const mirror of shuffledMirrors) {
    const url = `${mirror}/threads/search/${encodeURIComponent(keyword)}.json`;
    console.log(`[RSS Dynamic Rescue] Attempting fetch from: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const feed = await response.json();
      if (!feed || !feed.items || !Array.isArray(feed.items)) {
        throw new Error("Invalid JSON Feed structure");
      }
      
      const mappedPosts = feed.items.map(item => {
        const postText = item.summary || item.content_html || item.title || '無內文';
        const pubDate = item.date_published ? new Date(item.date_published) : new Date();
        const author = item.authors?.[0] || {};
        
        return {
          id: item.id || Math.random().toString(36).substr(2, 9),
          username: author.name || 'unknown',
          user_url: author.url || '',
          text: postText,
          url: item.url || '',
          likes: 0,
          replies: 0,
          time: Math.floor(pubDate.getTime() / 1000),
          time_str: '剛剛',
          theme: keyword,
          last_seen: Math.floor(Date.now() / 1000),
          first_seen: Math.floor(pubDate.getTime() / 1000),
          sentiment: classifySentiment(postText)
        };
      });
      
      // Merge and deduplicate
      const mergedMap = new Map();
      allPosts.forEach(post => {
        const key = post.id || post.url;
        if (key) mergedMap.set(key, post);
      });
      
      mappedPosts.forEach(post => {
        const key = post.id || post.url;
        if (key) mergedMap.set(key, post);
      });
      
      allPosts = Array.from(mergedMap.values());
      
      console.log(`[RSS Dynamic Rescue] Successfully merged ${mappedPosts.length} posts for theme: ${keyword} from mirror: ${mirror}`);
      
      updateDashboard();
      return; // Stop on first successful fetch
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[RSS Dynamic Rescue] Failover: Mirror ${mirror} failed for theme ${keyword}: ${err.message}`);
    }
  }
  
  console.error(`[RSS Dynamic Rescue] All RSS mirrors failed to fetch live trends for theme: ${keyword}`);
}

/**
 * Recovers live trends for all unique themes loaded in the dashboard.
 */
async function rescueLiveTrends() {
  const uniqueThemes = getUniqueThemes();
  for (const theme of uniqueThemes) {
    try {
      await fetchLiveTrends(theme);
    } catch (err) {
      console.error(`Failed dynamic rescue for theme ${theme}:`, err);
    }
  }
}
