// Global dashboard state
let allPosts = [];
let themeVolumeChart = null;
let themeEngagementChart = null;

// CSS HSL colors matching index.css
const THEME_COLORS = [
  'hsl(275, 80%, 60%)', // Theme 0: Purple
  'hsl(150, 75%, 45%)', // Theme 1: Emerald
  'hsl(30, 90%, 55%)',  // Theme 2: Orange
  'hsl(340, 85%, 55%)'  // Theme 3: Rose
];
const FALLBACK_COLOR = 'hsl(200, 85%, 50%)'; // Blue

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Dark/Light Mode
  initTheme();
  
  // 2. Load Data from window.crawledData
  loadCrawledData();

  // 3. Set Up UI Event Listeners
  setupEventListeners();

  // 4. Initial Render & Filter
  updateDashboard();
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
    // Theme check
    if (checkedThemes.length > 0 && !checkedThemes.includes(post.theme)) {
      return false;
    }
    // Min likes check
    if (post.likes < minLikes) {
      return false;
    }
    // Search query check (search in user, text, or theme)
    if (searchQuery) {
      const matchesText = post.text && post.text.toLowerCase().includes(searchQuery);
      const matchesUser = post.username && post.username.toLowerCase().includes(searchQuery);
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
        <span class="theme-badge ${themeClass}">${post.theme || '預設'}</span>
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
    return filteredPosts.filter(p => p.theme === theme).length;
  });

  // Theme Engagement (Averages)
  const engagementLabels = uniqueThemes;
  const avgLikesData = uniqueThemes.map(theme => {
    const themePosts = filteredPosts.filter(p => p.theme === theme);
    if (themePosts.length === 0) return 0;
    const totalLikes = themePosts.reduce((sum, p) => sum + (p.likes || 0), 0);
    return Math.round(totalLikes / themePosts.length * 10) / 10;
  });

  const avgRepliesData = uniqueThemes.map(theme => {
    const themePosts = filteredPosts.filter(p => p.theme === theme);
    if (themePosts.length === 0) return 0;
    const totalReplies = themePosts.reduce((sum, p) => sum + (p.replies || 0), 0);
    return Math.round(totalReplies / themePosts.length * 10) / 10;
  });

  const themeBorderColors = uniqueThemes.map(theme => getThemeColor(theme));
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#a0a0b0' : '#4a4a5a';
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
          borderColor: isDark ? '#1a1726' : '#ffffff'
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
                family: 'Inter',
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
            backgroundColor: 'hsl(340, 85%, 55%)',
            borderRadius: 6,
            barThickness: 16
          },
          {
            label: '平均回覆數',
            data: avgRepliesData,
            backgroundColor: 'hsl(200, 85%, 50%)',
            borderRadius: 6,
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
                family: 'Inter',
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
              font: { family: 'Inter', size: 11, weight: '600' }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Inter', size: 10 }
            }
          }
        }
      }
    });
  }
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
