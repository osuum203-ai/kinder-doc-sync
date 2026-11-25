/* 누리링크 — 앱 로직
   연간계획안 → 주간계획안 → 알림장 → 관찰일지 → 상담일지
   공유 Key: 월·주차 / 원아 ID / 누리과정 영역 태그, 저장: localStorage */
(function () {
  'use strict';

  var STORE = 'nurilink.v1';
  var state = null;
  var ui = { obsChild: null, obsAreas: [], counselChild: null, annualMonth: 11, day: null };

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 8); }
  function weekKey(y, m, w) { return y + '-' + pad(m) + '-W' + w; }
  function parseKey(k) {
    var p = String(k).split('-');
    return { year: Number(p[0]), month: Number(p[1]), week: Number(String(p[2]).replace('W', '')) };
  }
  function nowISO() { return new Date().toISOString(); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtDate(s) {
    if (!s) return '—';
    var p = String(s).slice(0, 10).split('-');
    return Number(p[1]) + '월 ' + Number(p[2]) + '일';
  }
  function hasBatchim(word) {
    if (!word) return null;
    var c = String(word).charCodeAt(String(word).length - 1);
    if (c < 0xac00 || c > 0xd7a3) return null;
    return (c - 0xac00) % 28 !== 0;
  }
  function josa(word, pair) {
    var parts = pair.split('/');
    var h = hasBatchim(word);
    if (h === null) return parts[0];
    return h ? parts[0] : parts[1];
  }
  function areaSlug(name) {
    var a = AREAS.filter(function (x) { return x.id === name; })[0];
    return a ? a.slug : 'nature';
  }
  function areaTag(name) {
    return '<span class="tag a-' + areaSlug(name) + '">' + esc(name) + '</span>';
  }
  function childById(id) {
    return state.children.filter(function (c) { return c.id === id; })[0] || { id: id, name: '원아', no: 0 };
  }
  function childIndex(id) {
    for (var i = 0; i < state.children.length; i++) if (state.children[i].id === id) return i;
    return 0;
  }
  function childInitial(name) { return String(name).slice(0, 1); }
  function toast(msg, kind) {
    var wrap = $('#toast-wrap');
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span class="tk">' + (kind === 'warn' ? '!' : '✓') + '</span><span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s ease'; t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, 2600);
  }

  /* ---------------- storage ---------------- */
  function save() {
    state.savedAt = nowISO();
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
    var stamp = $('#foot-stamp');
    if (stamp) {
      var d = new Date();
      stamp.textContent = '마지막 저장 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · 브라우저 저장소';
    }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.meta || !data.children) return null;
      return data;
    } catch (e) { return null; }
  }
  function boot() {
    state = load();
    if (!state) { state = buildSeed(); save(); }
    ui.obsChild = state.children[0].id;
    ui.counselChild = state.children[0].id;
    ui.annualMonth = state.meta.currentWeek.month;
  }

  /* ---------------- plan lookup ---------------- */
  function monthPlan(m) { return ANNUAL[String(m)] || null; }
  function weekPlan(key) {
    var p = parseKey(key);
    var mp = monthPlan(p.month);
    if (!mp) return null;
    return mp.weeks.filter(function (w) { return w.no === p.week; })[0] || null;
  }
  function currentKey() {
    var cw = state.meta.currentWeek;
    return weekKey(cw.year, cw.month, cw.week);
  }
  function ensureWeek(key) {
    if (!state.weekly[key]) {
      var p = parseKey(key);
      var mp = monthPlan(p.month);
      var wp = weekPlan(key) || {};
      var days = {};
      WEEK_DAYS.forEach(function (d) { days[d] = []; });
      state.weekly[key] = {
        theme: mp ? mp.theme : '',
        topic: wp.topic || '새 주제',
        goal: wp.goal || '',
        days: days,
        homeLink: []
      };
      save();
    }
    var w = state.weekly[key];
    WEEK_DAYS.forEach(function (d) { if (!w.days[d]) w.days[d] = []; });
    if (!w.homeLink) w.homeLink = [];
    return w;
  }
  function setCurrentWeek(month, week) {
    state.meta.currentWeek = { year: state.meta.class.year || 2026, month: month, week: week };
    ui.annualMonth = month;
    save();
    location.hash = '#/weekly';
  }
  function noticeFor(key) {
    return state.notices.filter(function (n) { return n.weekKey === key; })[0] || null;
  }

  /* ---------------- 서류 → 서류 변환 ---------------- */
  function generateNotice(key) {
    ensureWeek(key).homeLink = ensureWeek(key).homeLink || [];
    var wk = state.weekly[key];
    var p = parseKey(key);
    var cls = state.meta.class;
    var guide = [];
    WEEK_DAYS.forEach(function (day) {
      var acts = wk.days[day] || [];
      if (!acts.length) return;
      var titles = acts.map(function (a) { return '‘' + a.title + '’'; }).join(', ');
      guide.push(day + '요일에는 ' + titles + ' 놀이를 했어요. ' + acts[0].detail);
    });
    var opening = cls.name + ' 학부모님, 안녕하세요. 이번 주(' + p.month + '월 ' + p.week + '주) 우리 아이들은 ‘'
      + wk.topic + '’' + josa(wk.topic, '을/를') + ' 주제로 신나게 놀이했습니다. 아이들의 하루를 따뜻한 마음으로 담아 전해 드립니다.';
    return { opening: opening, guide: guide, homeLink: wk.homeLink.slice() };
  }

  function linkWeekToNotice(key) {
    var gen = generateNotice(key);
    var existing = noticeFor(key);
    if (!existing) {
      var children = {};
      state.children.forEach(function (cp) {
        children[cp.id] = { mood: '좋음', meal: '다 먹음', nap: '잘 잤어요', comment: '' };
      });
      existing = {
        id: uid('n-'), weekKey: key, date: todayStr(), status: 'draft',
        opening: gen.opening, guide: gen.guide, homeLink: gen.homeLink,
        children: children, updatedAt: nowISO()
      };
      state.notices.push(existing);
      save();
      toast('주간계획안 ' + countWeekActs(key) + '개 활동이 알림장 초안으로 변환되었습니다');
    } else {
      existing.opening = gen.opening;
      existing.guide = gen.guide;
      existing.homeLink = gen.homeLink;
      existing.updatedAt = nowISO();
      save();
      toast('알림장 문장을 주간계획안 기준으로 다시 생성했습니다');
    }
    location.hash = '#/notice';
  }
  function countWeekActs(key) {
    var w = state.weekly[key];
    if (!w) return 0;
    return WEEK_DAYS.reduce(function (n, d) { return n + (w.days[d] || []).length; }, 0);
  }

  function buildCounsel(childId) {
    var obs = state.observations.filter(function (o) { return o.childId === childId; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var notes = [];
    state.notices.forEach(function (n) {
      var c = n.children && n.children[childId];
      if (c) notes.push({ date: n.date, weekKey: n.weekKey, mood: c.mood, meal: c.meal, nap: c.nap, comment: c.comment });
    });
    notes.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    var counts = {};
    AREAS.forEach(function (a) { counts[a.id] = 0; });
    obs.forEach(function (o) {
      (o.areas || []).forEach(function (a) { if (counts[a] !== undefined) counts[a]++; });
    });
    var max = 1;
    Object.keys(counts).forEach(function (k) { if (counts[k] > max) max = counts[k]; });

    var strength = {
      '신체운동·건강': '몸을 크게 움직이며 활동을 끝까지 해내는',
      '의사소통': '자신의 생각을 문장으로 또박또박 표현하는',
      '사회관계': '친구를 먼저 살피고 도와주는',
      '예술경험': '자기만의 방법으로 끝까지 표현하는',
      '자연탐구': '궁금한 것을 직접 찾아 비교해 보는'
    };
    var homeIdea = {
      '신체운동·건강': '가족과 함께 걷기·뛰기 같은 몸놀이를 해 보시면 좋겠습니다.',
      '의사소통': '오늘 있었던 일을 그림일기로 이야기 나눠 보시면 좋겠습니다.',
      '사회관계': '가족과 함께하는 간단한 역할놀이를 해 보시면 좋겠습니다.',
      '예술경험': '집에 있는 재료로 자유롭게 만들어 보시면 좋겠습니다.',
      '자연탐구': '산책길에서 자연물을 관찰하고 이름 붙여 보시면 좋겠습니다.'
    };

    var summaries = AREAS.map(function (a) {
      var items = obs.filter(function (o) { return (o.areas || []).indexOf(a.id) >= 0; });
      var acts = [];
      items.forEach(function (i) { if (acts.indexOf(i.activity) < 0) acts.push(i.activity); });
      var text;
      if (!items.length) {
        text = a.id + ' 영역의 관찰 기록은 아직 없습니다. 다음 주 ' + a.id + ' 영역이 드러나는 놀이에서 이 아이의 모습을 한 번 관찰해 보세요.';
      } else {
        text = acts.slice(0, 3).join(', ') + ' 놀이에서 ' + items.length + '건의 관찰이 기록되었습니다. '
          + a.id + ' 영역에서 ' + strength[a.id] + ' 모습이 보입니다.';
      }
      return {
        id: a.id, slug: a.slug, count: items.length,
        level: Math.round((items.length / max) * 4),
        text: text,
        evidence: items[0] ? items[0].content : ''
      };
    });

    var points = [];
    var top = summaries.slice().sort(function (x, y) { return y.count - x.count; })[0];
    var low = summaries.slice().sort(function (x, y) { return x.count - y.count; })[0];

    if (obs.length) {
      if (top.count > 0) {
        points.push(top.id + ' 영역에서 기록이 가장 많이 쌓였습니다(' + top.count + '건). ' + strength[top.id] + ' 모습을 구체적으로 칭찬해 주시면 좋겠습니다.');
      }
      if (low.count <= 1) {
        points.push(low.id + ' 영역은 기록이 적습니다. 가정에서 ' + homeIdea[low.id] + ' 다음 상담 때 아이의 반응을 들려주세요.');
      }
      if (obs.length >= 3) {
        points.push('관찰일지 ' + obs.length + '건이 쌓여 발달 흐름을 함께 볼 수 있습니다. 최근 기록은 ' + fmtDate(obs[0].date) + '의 ‘' + obs[0].activity + '’ 관찰입니다.');
      }
    } else {
      points.push('아직 관찰일지 기록이 없습니다. 2주간 관찰일지를 2~3건 남긴 뒤 상담을 준비하시면 흐름을 함께 이야기할 수 있습니다.');
    }

    if (notes.length) {
      var mealGood = notes.filter(function (n) { return n.meal === '다 먹음'; }).length;
      var napGood = notes.filter(function (n) { return n.nap === '잘 잤어요'; }).length;
      points.push('알림장 ' + notes.length + '건 중 식사 ‘다 먹음’ ' + mealGood + '건, 낮잠 ‘잘 잤어요’ ' + napGood + '건입니다. 생활 습관은 ' + (mealGood >= notes.length / 2 ? '안정적으로 자리 잡고 있습니다.' : '조금씩 조절해 가는 중입니다.'));
      if (notes[0].comment) points.push('최근 알림장에서 “' + notes[0].comment + '”라고 전해 드린 부분을 상담에서 이어 이야기해 보세요.');
    } else {
      points.push('알림장 기록이 아직 없어 생활 습관 흐름은 다음 주 알림장부터 쌓입니다.');
    }

    return { obs: obs, notes: notes, counts: counts, summaries: summaries, points: points };
  }

  /* ---------------- modal ---------------- */
  function openModal(opts) {
    var ov = $('#overlay');
    ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
      + '<div class="modal-head"><div><h3>' + esc(opts.title) + '</h3>'
      + (opts.sub ? '<p>' + esc(opts.sub) + '</p>' : '') + '</div>'
      + '<button class="x-btn" data-action="close-modal" aria-label="닫기">✕</button></div>'
      + '<div class="modal-body">' + opts.body + '</div>'
      + '<div class="modal-foot">' + opts.foot + '</div></div>';
    ov.hidden = false;
    var first = ov.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 40);
  }
  function closeModal() {
    var ov = $('#overlay');
    ov.hidden = true;
    ov.innerHTML = '';
    ui.day = null;
  }

  function openActivity(day, id) {
    var key = currentKey();
    var wk = ensureWeek(key);
    ui.day = day;
    var act = null;
    if (id) act = (wk.days[day] || []).filter(function (a) { return a.id === id; })[0];
    var areaOpts = AREAS.map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (act && act.area === a.id ? ' selected' : '') + '>' + esc(a.id) + '</option>';
    }).join('');
    var dayOpts = WEEK_DAYS.map(function (d) {
      return '<option value="' + d + '"' + (d === day ? ' selected' : '') + '>' + d + '요일</option>';
    }).join('');
    var body = '<form id="act-form" autocomplete="off">'
      + '<input type="hidden" name="id" value="' + (act ? esc(act.id) : '') + '">'
      + '<div class="grid g2"><div class="field"><label>요일</label><select name="day">' + dayOpts + '</select></div>'
      + '<div class="field"><label>누리과정 영역</label><select name="area">' + areaOpts + '</select></div></div>'
      + '<div class="field"><label>놀이 활동명</label><input type="text" name="title" required maxlength="40" value="' + (act ? esc(act.title) : '') + '" placeholder="예: 공룡 발자국 찾기"></div>'
      + '<div class="field"><label>활동 내용</label><textarea name="detail" rows="4" placeholder="아이들이 어떤 반응을 보였는지 부모님께 전할 말투로 적어 보세요.">' + (act ? esc(act.detail) : '') + '</textarea></div>'
      + '<div class="field"><label>가정 연계 한 줄</label><input type="text" name="home" maxlength="60" value="' + (act ? esc(act.home) : '') + '" placeholder="예: 산책길에서 나뭇잎을 함께 관찰해 보기">'
      + '<p class="hint">알림장으로 연동할 때 이 내용이 학부모님께 전하는 문장으로 함께 들어갑니다.</p></div>'
      + '</form>';
    var foot = (act ? '<button class="btn btn-ghost" data-action="act-delete" data-id="' + esc(act.id) + '">삭제</button>' : '')
      + '<button class="btn btn-outline" data-action="close-modal">취소</button>'
      + '<button class="btn btn-primary" type="submit" form="act-form">저장</button>';
    openModal({
      title: act ? '놀이 활동 수정' : '놀이 활동 추가',
      sub: parseKey(key).month + '월 ' + parseKey(key).week + '주 · 주간계획안',
      body: body, foot: foot
    });
  }

  /* ---------------- shell ---------------- */
  var TITLES = {
    home: ['통합 대시보드', '햇살반 문서 흐름'],
    annual: ['연간계획안', '한 해의 큰 흐름'],
    weekly: ['주간계획안', '이번 주 우리 반 놀이'],
    notice: ['알림장', '학부모님께 전하는 오늘'],
    observe: ['관찰일지', '아이의 오늘을 기록'],
    counsel: ['상담일지', '쌓인 기록으로 준비하는 상담'],
    mapping: ['데이터 매핑 구조', '5종 서류를 잇는 세 개의 Key']
  };
  var SUBS = {
    home: '연간계획안에서 시작해 상담일지까지, 다섯 서류가 같은 데이터로 이어집니다.',
    annual: '월별 대주제와 주차를 설계하면 주간계획안의 주제와 목표가 자동으로 따라옵니다.',
    weekly: '연간계획안의 대주제가 연결되어 있고, 여기서 만든 활동이 알림장의 문장이 됩니다.',
    notice: '주간계획안의 활동이 학부모 눈높이의 문장으로 바뀌어 초안이 됩니다.',
    observe: '원아와 이번 주 활동을 고르고 누리과정 영역을 태그하면 상담일지의 재료가 됩니다.',
    counsel: '원아를 고르면 그동안의 관찰일지와 알림장이 자동으로 집계됩니다.',
    mapping: '월·주차, 원아 ID, 누리과정 영역 태그 — 세 Key가 서류 사이를 잇습니다.'
  };

  function setNav(route) {
    $$('.nav-item').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === route);
    });
    var cw = state.meta.currentWeek;
    var chipText = $('#week-chip-text');
    if (chipText) chipText.textContent = cw.month + '월 ' + cw.week + '주';
    var cn = $('#class-name'); if (cn) cn.textContent = state.meta.class.name;
    var cm = $('#class-meta'); if (cm) cm.textContent = state.meta.class.age + ' · 담임 ' + state.meta.class.teacher;
  }

  function route() {
    var h = (location.hash || '#/home').replace('#/', '');
    if (!TITLES[h]) h = 'home';
    var t = TITLES[h];
    $('#crumb').textContent = t[0];
    $('#page-title').textContent = t[1];
    $('#page-sub').textContent = SUBS[h];
    setNav(h);
    var html = PAGES[h]();
    var v = $('#view');
    v.innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (h === 'notice') updatePreview();
  }

  /* ---------------- pages ---------------- */
  var PAGES = {};

  PAGES.home = function () {
    var key = currentKey();
    var w = state.weekly[key];
    var p = parseKey(key);
    var wp = weekPlan(key) || {};
    var notices = state.notices.length;
    var obsCount = state.observations.length;
    var counselCount = state.counselings.length;
    var cw = state.meta.currentWeek;

    var nodes = [
      { n: '01', name: '연간계획안', route: 'annual', desc: '월별 대주제와 주차 설계', keyTxt: '월·주차', badge: '' },
      { n: '02', name: '주간계획안', route: 'weekly', desc: '대주제·목표가 자동 연결', keyTxt: '월·주차', badge: cw.month + '월 ' + cw.week + '주' },
      { n: '03', name: '알림장', route: 'notice', desc: '활동이 학부모 문장으로', keyTxt: '주차 + 원아 ID', badge: notices ? notices + '건' : '' },
      { n: '04', name: '관찰일지', route: 'observe', desc: '원아별 관찰과 영역 태그', keyTxt: '원아 ID + 영역', badge: obsCount ? obsCount + '건' : '' },
      { n: '05', name: '상담일지', route: 'counsel', desc: '누적 기록 자동 집계', keyTxt: '원아 ID', badge: counselCount ? counselCount + '건' : '' }
    ];
    var flow = nodes.map(function (nd) {
      return '<button class="flow-node" data-action="go" data-route="' + nd.route + '">'
        + (nd.badge ? '<span class="flow-badge">' + esc(nd.badge) + '</span>' : '')
        + '<span class="flow-step">STEP ' + nd.n + '</span>'
        + '<h3>' + esc(nd.name) + '</h3>'
        + '<p>' + esc(nd.desc) + '</p>'
        + '<span class="flow-key">' + esc(nd.keyTxt) + '</span>'
        + '</button>';
    }).join('');

    var todayActs = '';
    var todayDay = WEEK_DAYS[Math.min(4, Math.max(0, new Date().getDay() - 1))];
    var dayActs = (w && w.days[todayDay]) || [];
    if (!dayActs.length) {
      WEEK_DAYS.some(function (d) { if (w && (w.days[d] || []).length) { dayActs = w.days[d]; todayDay = d; return true; } return false; });
    }
    todayActs = dayActs.slice(0, 3).map(function (a) {
      return '<div class="today-act"><span class="today-day">' + todayDay + '</span><div><p>' + esc(a.title) + '</p><span>' + esc(a.area) + '</span></div></div>';
    }).join('');
    if (!todayActs) todayActs = '<p class="hint">이번 주 활동이 아직 없습니다. 주간계획안에서 활동을 추가해 보세요.</p>';

    var recent = [];
    state.observations.forEach(function (o) {
      recent.push({ date: o.date, who: childById(o.childId).name, what: '관찰일지 · ' + o.activity, route: 'observe' });
    });
    state.notices.forEach(function (n) {
      recent.push({ date: n.date, who: state.meta.class.name, what: '알림장 · ' + (n.status === 'sent' ? '학부모 발송' : '초안 작성'), route: 'notice' });
    });
    state.counselings.forEach(function (s) {
      recent.push({ date: s.date, who: childById(s.childId).name, what: '상담일지 · 상담 준비', route: 'counsel' });
    });
    recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    recent = recent.slice(0, 5);
    var recentHtml = recent.length ? '<ul class="recent">' + recent.map(function (r) {
      return '<li><span class="who">' + esc(r.who) + '</span><span class="what">' + esc(r.what) + '</span><span class="when">' + fmtDate(r.date) + '</span></li>';
    }).join('') + '</ul>' : '<div class="empty"><strong>아직 기록이 없습니다</strong>주간계획안에서 알림장으로 연동해 보세요.</div>';

    return ''
      + '<div class="hero">'
      + '<div><span class="eyebrow">' + cw.year + '학년도 · ' + esc(state.meta.class.name) + '</span>'
      + '<h2>이번 주는 <em>‘' + esc(w ? w.topic : wp.topic || '새 주제') + '’</em>을 놀이로 만납니다.<br>다섯 서류가 한 줄로 이어져 있어요.</h2>'
      + '<p>' + esc(w ? w.goal : '') + '</p>'
      + '<div class="hero-actions row"><button class="btn btn-primary" data-action="go" data-route="weekly">이번 주 주간계획안 열기</button>'
      + '<button class="btn btn-outline" data-action="link-notice">알림장으로 연동하기</button></div></div>'
      + '<div class="hero-stats">'
      + '<div class="stat sage"><b>' + p.month + '월 ' + p.week + '주</b><span>현재 연결된 주차</span></div>'
      + '<div class="stat"><b>' + countWeekActs(key) + '</b><span>이번 주 놀이 활동</span></div>'
      + '<div class="stat amber"><b>' + notices + '</b><span>작성된 알림장</span></div>'
      + '<div class="stat"><b>' + obsCount + '</b><span>관찰일지 · 상담 ' + counselCount + '건</span></div>'
      + '</div></div>'
      + '<div class="section-head"><div><h2>5단계 서류 연동 흐름</h2><p>카드를 누르면 해당 서류로 바로 이동합니다.</p></div>'
      + '<button class="btn btn-ghost btn-sm" data-action="go" data-route="mapping">연결 Key 보기 →</button></div>'
      + '<div class="flow">' + flow + '</div>'
      + '<div class="grid g2" style="margin-top:26px">'
      + '<div class="card today-card"><div class="spread"><span class="today-title">오늘의 놀이 활동</span>'
      + '<span class="pill pill-line">' + p.month + '월 ' + p.week + '주</span></div>' + todayActs
      + '<button class="btn btn-outline btn-sm" data-action="go" data-route="weekly" style="align-self:flex-start">주간계획안에서 전체 보기</button></div>'
      + '<div class="card card-pad"><div class="spread" style="margin-bottom:6px"><span class="today-title">최근 기록</span>'
      + '<span class="pill pill-line">' + recent.length + '건</span></div>' + recentHtml + '</div>'
      + '</div>';
  };

  PAGES.annual = function () {
    var m = ui.annualMonth || 11;
    var mp = monthPlan(m) || monthPlan(11);
    var months = Object.keys(ANNUAL).map(Number).sort(function (a, b) { return a - b; });
    var tabs = months.map(function (mm) {
      return '<button class="month-tab' + (mm === m ? ' active' : '') + '" data-action="pick-month" data-month="' + mm + '">' + mm + '월</button>';
    }).join('');

    var weeks = mp.weeks.map(function (wk) {
      var key = weekKey(state.meta.class.year, m, wk.no);
      var has = state.weekly[key] ? countWeekActs(key) : 0;
      var isCur = (state.meta.currentWeek.month === m && state.meta.currentWeek.week === wk.no);
      return '<button class="week-card" data-action="annual-week" data-month="' + m + '" data-week="' + wk.no + '">'
        + '<div class="wk-top"><span class="wk-no">' + wk.no + '주차' + (isCur ? ' · 이번 주' : '') + '</span><span class="wk-range">' + esc(wk.range) + '</span></div>'
        + '<h4>' + esc(wk.topic) + '</h4>'
        + '<p>' + esc(wk.goal) + '</p>'
        + '<span class="wk-go">' + (has ? '활동 ' + has + '개 연결됨 · 주간계획안 열기 →' : '주간계획안 만들기 →') + '</span>'
        + '</button>';
    }).join('');

    var areas = AREAS.map(function (a) {
      return '<div class="area-line">' + areaTag(a.id) + '<p>' + esc(a.desc) + '</p></div>';
    }).join('');

    return ''
      + '<div class="card card-pad"><div class="spread" style="align-items:flex-start;gap:20px;flex-wrap:wrap">'
      + '<div><span class="eyebrow">' + state.meta.class.year + '학년도 연간계획안</span>'
      + '<h2 style="font-size:17px;font-weight:680;margin-top:6px;letter-spacing:-0.02em">월별 대주제 · 주차별 주제 · 누리과정 5개 영역</h2>'
      + '<p class="hint" style="margin-top:5px">주차 카드를 누르면 그 주제가 주간계획안으로 자동 연결됩니다.</p></div>'
      + '<div class="month-tabs">' + tabs + '</div></div></div>'
      + '<div class="card month-head"><div class="month-no">' + m + '<small>MONTH</small></div>'
      + '<div><h3>' + esc(mp.theme) + '</h3><p>월 목표 · ' + esc(mp.goal) + '</p></div></div>'
      + '<div class="week-grid">' + weeks + '</div>'
      + '<div class="section-head"><div><h2>누리과정 5개 영역</h2><p>주간계획안 활동과 관찰일지 태그가 이 영역을 기준으로 묶입니다.</p></div></div>'
      + '<div class="card card-pad"><div class="area-list">' + areas + '</div></div>';
  };

  PAGES.weekly = function () {
    var key = currentKey();
    var wk = ensureWeek(key);
    var p = parseKey(key);
    var mp = monthPlan(p.month);
    var stripe = (mp ? mp.weeks : []).map(function (w) {
      var k = weekKey(p.year, p.month, w.no);
      var has = state.weekly[k] ? countWeekActs(k) : 0;
      return '<button class="ws-item' + (w.no === p.week ? ' active' : '') + (has ? ' has' : '') + '" data-action="week-pick" data-month="' + p.month + '" data-week="' + w.no + '">'
        + '<span class="dot"></span>' + w.no + '주' + (has ? ' <span style="opacity:.6">·' + has + '</span>' : '') + '</button>';
    }).join('');

    var counts = {};
    AREAS.forEach(function (a) { counts[a.id] = 0; });
    WEEK_DAYS.forEach(function (d) {
      (wk.days[d] || []).forEach(function (a) { if (counts[a.area] !== undefined) counts[a.area]++; });
    });
    var maxCount = 1;
    Object.keys(counts).forEach(function (k2) { if (counts[k2] > maxCount) maxCount = counts[k2]; });

    var cols = WEEK_DAYS.map(function (d, i) {
      var acts = (wk.days[d] || []).map(function (a) {
        return '<button class="act-card" data-action="act-edit" data-day="' + d + '" data-id="' + esc(a.id) + '">'
          + '<h5>' + esc(a.title) + '</h5>'
          + '<p>' + esc(a.detail) + '</p>'
          + areaTag(a.area)
          + '</button>';
      }).join('');
      var isToday = key === currentKey() && WEEK_DAYS[new Date().getDay() - 1] === d;
      return '<div class="day-col' + (isToday ? ' is-today' : '') + '">'
        + '<div class="day-head"><b>' + d + '요일</b><span>' + (key === '2026-11-W4' ? (DAY_DATES[d] || '') : '') + '</span></div>'
        + acts
        + '<button class="add-act" data-action="act-add" data-day="' + d + '">+ 활동 추가</button>'
        + '</div>';
    }).join('');

    var balance = AREAS.map(function (a) {
      var n = counts[a.id];
      var w = Math.round((n / maxCount) * 100);
      return '<span class="balance-chip a-' + a.slug + '" style="border-color:transparent"><b>' + a.short + '</b> ' + n + '개'
        + '<span class="bar"><i style="width:' + w + '%"></i></span></span>';
    }).join('');

    var homes = wk.homeLink.length ? '<ul class="homelink-list">' + wk.homeLink.map(function (h, i) {
      return '<li><span class="li-num">' + pad(i + 1) + '</span><span style="flex:1">' + esc(h) + '</span>'
        + '<button class="btn btn-ghost btn-sm" data-action="home-del" data-i="' + i + '">삭제</button></li>';
    }).join('') + '</ul>' : '<div class="empty"><strong>가정 연계 안내가 없습니다</strong>아래에서 한 줄씩 추가해 보세요.</div>';

    var linkedGuide = state.notices.some(function (n) { return n.weekKey === key; });

    return ''
      + '<div class="linked-bar"><span class="lb-icon">↳</span>'
      + '<dl><div><dt>연간계획안</dt><dd>' + p.month + '월 ' + p.week + '주 · ' + esc(wk.theme) + '</dd></div>'
      + '<div><dt>주간 주제</dt><dd>' + esc(wk.topic) + '</dd></div>'
      + '<div><dt>주간 목표</dt><dd style="font-weight:500">' + esc(wk.goal) + '</dd></div></dl>'
      + '<span class="pill pill-sage" style="margin-left:auto">자동 연결됨</span></div>'
      + '<div class="week-strip">' + stripe + '</div>'
      + '<div class="section-head"><div><h2>요일별 놀이 활동</h2><p>활동을 누르면 수정할 수 있고, 추가한 활동은 알림장 문장으로 그대로 이어집니다.</p></div>'
      + '<div class="row"><button class="btn btn-outline btn-sm" data-action="go" data-route="observe">관찰일지 쓰기</button>'
      + '<button class="btn btn-amber" data-action="link-notice">알림장으로 연동하기</button></div></div>'
      + '<div class="day-grid">' + cols + '</div>'
      + '<div class="area-balance">' + balance + '</div>'
      + '<div class="grid g2" style="margin-top:24px;align-items:start">'
      + '<div class="card card-pad"><div class="spread" style="margin-bottom:10px"><span class="today-title">가정 연계 안내</span>'
      + '<span class="pill pill-line">' + wk.homeLink.length + '개</span></div>' + homes
      + '<div class="row" style="margin-top:12px"><input type="text" id="home-input" placeholder="가정에서 함께할 한 줄을 적어 주세요" style="flex:1;min-width:180px">'
      + '<button class="btn btn-outline btn-sm" data-action="home-add">추가</button></div></div>'
      + '<div class="card card-pad"><div class="spread" style="margin-bottom:10px"><span class="today-title">알림장 연동 상태</span>'
      + (linkedGuide ? '<span class="pill pill-sage">초안 있음</span>' : '<span class="pill pill-amber">아직 없음</span>') + '</div>'
      + '<p class="hint">‘알림장으로 연동하기’를 누르면 이번 주 활동 ' + countWeekActs(key) + '개와 가정 연계 안내가 학부모 눈높이의 따뜻한 문장으로 바뀌어 알림장 초안에 들어갑니다. 원아별 전달사항은 알림장 화면에서 채울 수 있어요.</p>'
      + '<button class="btn btn-primary btn-sm" data-action="link-notice" style="margin-top:12px">' + (linkedGuide ? '문장 다시 생성하기' : '알림장 초안 만들기') + '</button></div>'
      + '</div>';
  };

  PAGES.notice = function () {
    var key = currentKey();
    var p = parseKey(key);
    var wk = state.weekly[key];
    var n = noticeFor(key);
    var linkedFrom = '<span class="pill pill-sage">주간계획안 ' + p.month + '월 ' + p.week + '주에서 연동</span>';

    if (!n) {
      return '<div class="card card-pad" style="text-align:center;padding:44px 28px">'
        + '<span class="eyebrow">알림장 초안 없음</span>'
        + '<h2 style="font-size:18px;font-weight:680;margin:8px 0 6px;letter-spacing:-0.02em">이번 주 알림장을 아직 만들지 않았어요</h2>'
        + '<p class="hint" style="max-width:460px;margin:0 auto 18px">주간계획안의 놀이 활동과 가정 연계 안내를 학부모님께 전하는 문장으로 자동 변환해 초안을 만듭니다.</p>'
        + '<button class="btn btn-primary" data-action="link-notice">주간계획안에서 알림장 초안 만들기</button></div>';
    }

    var childRows = state.children.map(function (c) {
      var e = n.children[c.id] || (n.children[c.id] = { mood: '좋음', meal: '다 먹음', nap: '잘 잤어요', comment: '' });
      return '<div class="child-row">'
        + '<div class="child-id"><span class="avatar av-' + ((childIndex(c.id) % 4) + 1) + '">' + esc(childInitial(c.name)) + '</span><b>' + esc(c.name) + '</b></div>'
        + '<select data-child="' + c.id + '" data-field="mood">' + opt(['좋음', '보통', '조금 가라앉음'], e.mood) + '</select>'
        + '<select data-child="' + c.id + '" data-field="meal">' + opt(['다 먹음', '조금 먹음', '거의 안 먹음'], e.meal) + '</select>'
        + '<select data-child="' + c.id + '" data-field="nap">' + opt(['잘 잤어요', '조금 잤어요', '안 잤어요'], e.nap) + '</select>'
        + '<div class="child-note"><input type="text" data-child="' + c.id + '" data-field="comment" maxlength="80" value="' + esc(e.comment) + '" placeholder="' + esc(c.name) + '에게 전할 오늘의 한마디"></div>'
        + '</div>';
    }).join('');

    return ''
      + '<div class="split"><div>'
      + '<div class="card card-pad">'
      + '<div class="spread" style="margin-bottom:4px"><div class="row">' + linkedFrom
      + '<span class="pill ' + (n.status === 'sent' ? 'pill-sage' : 'pill-amber') + '">' + (n.status === 'sent' ? '학부모 발송 완료' : '초안') + '</span></div>'
      + '<span class="hint">' + fmtDate(n.date) + ' · ' + esc(state.meta.class.name) + '</span></div>'
      + '<div class="field"><label>인사말</label><textarea id="n-opening" rows="2">' + esc(n.opening) + '</textarea></div>'
      + '<div class="field"><label>이번 주 놀이 안내 (주간계획안에서 자동 변환)</label>'
      + '<textarea id="n-guide" rows="10">' + esc((n.guide || []).join('\n\n')) + '</textarea>'
      + '<p class="hint">줄을 고치면 오른쪽 학부모 미리보기에 바로 반영됩니다.</p></div>'
      + '<div class="field"><label>가정 연계 안내</label><div class="row">'
      + (n.homeLink || []).map(function (h) { return '<span class="pill pill-line">' + esc(h) + '</span>'; }).join('')
      + '</div></div>'
      + '<div class="row" style="margin-top:16px"><button class="btn btn-primary" data-action="notice-save">저장하기</button>'
      + '<button class="btn btn-outline" data-action="regenerate">문장 다시 생성</button>'
      + '<button class="btn btn-ghost" data-action="notice-toggle">' + (n.status === 'sent' ? '초안으로 되돌리기' : '학부모 발송 표시') + '</button></div>'
      + '</div>'
      + '<div class="card card-pad" style="margin-top:16px"><div class="spread" style="margin-bottom:8px"><span class="today-title">원아별 전달사항</span>'
      + '<span class="pill pill-line">원아 ID로 연결</span></div>'
      + '<p class="hint" style="margin-bottom:8px">기분 · 식사 · 낮잠 · 오늘의 놀이 코멘트. 여기 남긴 기록은 상담일지에 생활 습관 흐름으로 집계됩니다.</p>'
      + childRows + '</div>'
      + '</div>'
      + '<div class="phone-wrap"><div class="phone"><div class="phone-screen" id="phone-screen"></div></div>'
      + '<p class="hint" style="text-align:center;margin-top:12px">학부모님 스마트폰 화면 미리보기</p></div>'
      + '</div>';
  };

  function opt(list, cur) {
    return list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }

  function updatePreview() {
    var screen = $('#phone-screen');
    if (!screen) return;
    var key = currentKey();
    var n = noticeFor(key);
    if (!n) { screen.innerHTML = '<p class="hint">알림장 초안을 먼저 만들어 주세요.</p>'; return; }
    var p = parseKey(key);
    var t = new Date();
    var time = pad(t.getHours()) + ':' + pad(t.getMinutes());
    var body = (n.guide || []).filter(Boolean).map(function (g) { return '<p>' + esc(g) + '</p>'; }).join('');
    var kids = state.children.map(function (c) {
      var e = n.children[c.id] || {};
      if (!e.comment && !e.mood) return '';
      return '<div class="ph-child"><b>' + esc(c.name) + '</b>'
        + '<div class="ph-line">기분 ' + esc(e.mood || '—') + ' · 식사 ' + esc(e.meal || '—') + ' · 낮잠 ' + esc(e.nap || '—') + '</div>'
        + (e.comment ? '<div class="ph-line" style="color:#3C4A43;margin-top:4px">' + esc(e.comment) + '</div>' : '')
        + '</div>';
    }).join('');
    screen.innerHTML = '<div class="ph-status"><span>' + time + '</span><span>●●● ▮</span></div>'
      + '<div class="ph-head"><span class="ph-logo">누리</span><div><b>' + esc(state.meta.class.name) + ' 알림장</b>'
      + '<span>' + esc(state.meta.class.age) + ' · 담임 ' + esc(state.meta.class.teacher) + '</span></div>'
      + '<span class="ph-date">' + p.month + '/' + fmtDate(n.date).split(' ')[1].replace('일', '') + '</span></div>'
      + '<div class="ph-body"><p style="color:#6B7A73;font-size:11px">' + esc(n.opening) + '</p>' + body
      + (kids ? '<h4>우리 아이 오늘</h4>' + kids : '')
      + '<div class="ph-sign">— ' + esc(state.meta.class.name) + ' 담임 ' + esc(state.meta.class.teacher) + ' —</div>'
      + '</div>';
  }

  PAGES.observe = function () {
    var key = currentKey();
    var wk = ensureWeek(key);
    var p = parseKey(key);
    var sel = ui.obsChild || state.children[0].id;
    var picks = state.children.map(function (c) {
      return '<button class="child-pick' + (c.id === sel ? ' active' : '') + '" data-action="pick-child" data-scope="obs" data-child="' + c.id + '">'
        + '<span class="avatar av-' + ((childIndex(c.id) % 4) + 1) + '">' + esc(childInitial(c.name)) + '</span>' + esc(c.name) + '</button>';
    }).join('');

    var actList = [];
    WEEK_DAYS.forEach(function (d) {
      (wk.days[d] || []).forEach(function (a) { actList.push({ day: d, a: a }); });
    });
    var actOpts = actList.map(function (x) {
      return '<option value="' + esc(x.a.title) + '">' + x.day + ' · ' + esc(x.a.title) + ' (' + esc(x.a.area) + ')</option>';
    }).join('');
    var actChips = actList.map(function (x) {
      return '<button type="button" class="pill pill-line" data-action="pick-activity" data-title="' + esc(x.a.title) + '" style="cursor:pointer">' + x.day + ' ' + esc(x.a.title) + '</button>';
    }).join('');

    var areaToggles = AREAS.map(function (a) {
      var on = ui.obsAreas.indexOf(a.id) >= 0;
      return '<button type="button" class="area-toggle' + (on ? ' on' : '') + '" data-action="toggle-area" data-area="' + esc(a.id) + '">' + esc(a.id) + '</button>';
    }).join('');

    var mine = state.observations.filter(function (o) { return o.childId === sel; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var list = mine.length ? mine.map(function (o) {
      return '<div class="obs-item"><div class="obs-top"><b>' + esc(childById(o.childId).name) + '</b>'
        + '<span class="pill pill-line">' + esc(o.activity) + '</span><span class="when">' + fmtDate(o.date) + '</span></div>'
        + '<p>' + esc(o.content) + '</p>'
        + '<div class="obs-meta">' + (o.areas || []).map(areaTag).join('')
        + '<button class="btn btn-ghost btn-sm" data-action="obs-del" data-id="' + esc(o.id) + '" style="margin-left:auto">삭제</button></div></div>';
    }).join('') : '<div class="empty"><strong>아직 기록이 없습니다</strong>' + esc(childById(sel).name) + '의 오늘을 한 줄씩 남겨 보세요.</div>';

    return ''
      + '<div class="grid" style="grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);align-items:start;gap:18px">'
      + '<div class="card card-pad">'
      + '<div class="spread" style="margin-bottom:12px"><div><span class="eyebrow">관찰 대상</span><div class="child-picker" style="margin-top:8px">' + picks + '</div></div>'
      + '<span class="pill pill-sage">' + p.month + '월 ' + p.week + '주 활동 연결</span></div>'
      + '<form id="obs-form" autocomplete="off">'
      + '<input type="hidden" name="childId" value="' + sel + '">'
      + '<div class="field"><label>이번 주 놀이 활동에서 고르기</label>'
      + '<div class="row" style="margin-bottom:8px">' + (actChips || '<span class="hint">이번 주 활동이 없습니다.</span>') + '</div>'
      + '<select name="activity" id="obs-activity">' + (actOpts || '<option value="">이번 주 활동 없음</option>') + '<option value="__custom">직접 입력</option></select>'
      + '<input type="text" name="activityCustom" id="obs-custom" placeholder="활동명 직접 입력 (선택)" style="margin-top:8px">'
      + '<p class="hint">주간계획안의 활동을 고르면 상담일지에서 활동별로 묶여 집계됩니다.</p></div>'
      + '<div class="field"><label>누리과정 영역 태그 <span class="hint" style="display:inline">(복수 선택)</span></label>'
      + '<div class="area-tags">' + areaToggles + '</div></div>'
      + '<div class="field"><label>관찰 내용</label>'
      + '<textarea name="content" rows="5" required placeholder="무엇을 했는지, 아이가 어떤 말과 행동을 보였는지 구체적으로 적어 주세요."></textarea></div>'
      + '<div class="field" style="max-width:200px"><label>관찰일</label><input type="date" name="date" value="' + todayStr() + '"></div>'
      + '<div class="row" style="margin-top:14px"><button class="btn btn-primary" type="submit">관찰일지 저장</button>'
      + '<button class="btn btn-outline" type="button" data-action="go" data-route="counsel">상담일지에 반영하기</button></div>'
      + '</form></div>'
      + '<div class="card card-pad"><div class="spread" style="margin-bottom:6px"><span class="today-title">' + esc(childById(sel).name) + ' 관찰 기록</span>'
      + '<span class="pill pill-line">' + mine.length + '건</span></div>'
      + '<p class="hint" style="margin-bottom:10px">' + esc(childById(sel).note || '') + '</p>'
      + list + '</div></div>';
  };

  PAGES.counsel = function () {
    var sel = ui.counselChild || state.children[0].id;
    var c = childById(sel);
    var data = buildCounsel(sel);
    var picks = state.children.map(function (k) {
      return '<button class="child-pick' + (k.id === sel ? ' active' : '') + '" data-action="pick-child" data-scope="counsel" data-child="' + k.id + '">'
        + '<span class="avatar av-' + ((childIndex(k.id) % 4) + 1) + '">' + esc(childInitial(k.name)) + '</span>' + esc(k.name) + '</button>';
    }).join('');

    var dev = data.summaries.map(function (s) {
      var meter = '';
      for (var i = 0; i < 4; i++) meter += '<i class="' + (i < s.level ? 'on' : '') + '"></i>';
      return '<div class="dev-card"><div class="dev-top"><span class="tag a-' + s.slug + '">' + esc(s.id) + '</span>'
        + '<span class="row" style="gap:8px"><span class="dev-meter">' + meter + '</span><span class="hint">' + s.count + '건</span></span></div>'
        + '<p>' + esc(s.text) + '</p>'
        + (s.evidence ? '<p class="evidence">“' + esc(String(s.evidence).replace(/“/g, '‘').replace(/”/g, '’').slice(0, 72)) + (String(s.evidence).length > 72 ? '…' : '') + '”</p>' : '')
        + '</div>';
    }).join('');

    var points = data.points.map(function (pt, i) {
      return '<li><span class="n">' + pad(i + 1) + '</span><span>' + esc(pt) + '</span></li>';
    }).join('');

    var saved = state.counselings.filter(function (s) { return s.childId === sel; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var latest = saved[0];
    var savedAll = state.counselings.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var savedList = savedAll.length ? '<ul class="saved-list">' + savedAll.map(function (s) {
      return '<li><b>' + esc(childById(s.childId).name) + '</b><span>' + fmtDate(s.date) + '</span><em>교사 소견 ' + (s.teacherNote ? '작성됨' : '없음') + '</em></li>';
    }).join('') + '</ul>' : '<div class="empty"><strong>저장된 상담일지가 없습니다</strong>아래 소견을 적고 저장해 보세요.</div>';

    return ''
      + '<div class="card card-pad"><div class="spread" style="flex-wrap:wrap;gap:14px">'
      + '<div><span class="eyebrow">상담 대상</span><div class="child-picker" style="margin-top:8px">' + picks + '</div></div>'
      + '<div class="row"><span class="pill pill-sage">관찰일지 ' + data.obs.length + '건</span>'
      + '<span class="pill pill-amber">알림장 기록 ' + data.notes.length + '건</span>'
      + '<span class="pill pill-line">자동 집계</span></div></div>'
      + '<p class="hint" style="margin-top:10px">' + esc(c.name) + ' · ' + esc(c.birth || '') + ' · ' + esc(c.note || '') + '</p></div>'
      + '<div class="grid" style="grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:18px;margin-top:16px;align-items:start">'
      + '<div>'
      + '<div class="section-head" style="margin-top:0"><div><h2>누리과정 5개 영역 발달 요약</h2><p>관찰일지 태그와 알림장 기록을 Key로 묶어 자동 생성했습니다.</p></div></div>'
      + '<div class="dev-grid">' + dev + '</div>'
      + '</div>'
      + '<div>'
      + '<div class="section-head" style="margin-top:0"><div><h2>학부모 상담 포인트 초안</h2><p>기록에서 뽑아낸 이야깃거리입니다.</p></div></div>'
      + '<ul class="point-list">' + points + '</ul>'
      + '<div class="card card-pad" style="margin-top:16px"><div class="field" style="margin-top:0"><label>교사 소견</label>'
      + '<textarea id="c-note" rows="6" placeholder="상담에서 전하고 싶은 말을 자유롭게 적어 주세요.">' + esc(latest ? latest.teacherNote : '') + '</textarea></div>'
      + '<div class="row" style="margin-top:12px"><button class="btn btn-primary" data-action="counsel-save">상담일지 저장</button>'
      + '<button class="btn btn-outline" data-action="go" data-route="observe">관찰일지 더 쓰기</button></div></div>'
      + '<div class="card card-pad" style="margin-top:16px"><div class="spread" style="margin-bottom:8px"><span class="today-title">저장된 상담일지</span>'
      + '<span class="pill pill-line">원아 ID로 연결</span></div>' + savedList + '</div>'
      + '</div></div>';
  };

  PAGES.mapping = function () {
    var key = currentKey();
    var keys = [
      { no: 'KEY 01', name: '월 · 주차', desc: '연간계획안의 주차가 주간계획안과 알림장을 잇습니다.', code: key },
      { no: 'KEY 02', name: '원아 ID', desc: '알림장·관찰일지·상담일지가 같은 아이를 가리킵니다.', code: state.children.map(function (c) { return c.id; }).join(' / ') },
      { no: 'KEY 03', name: '누리과정 영역 태그', desc: '활동과 관찰이 5개 영역으로 묶여 발달 요약이 됩니다.', code: AREAS.map(function (a) { return a.short; }).join(' · ') }
    ];
    var keyCards = keys.map(function (k) {
      return '<div class="key-card"><span class="kc-no">' + k.no + '</span><h3>' + esc(k.name) + '</h3><p>' + esc(k.desc) + '</p><code>' + esc(k.code) + '</code></div>';
    }).join('');

    var rows = [
      ['① 연간계획안', '월 · 주차를 만든다', '—', '주차별 주제·목표의 원본', '11월 4주 · 공룡이 살던 숲'],
      ['② 주간계획안', '월 · 주차를 받는다', '월 · 주차', '연간계획안의 주제·목표 + 요일별 활동', '2026-11-W4'],
      ['③ 알림장', '월 · 주차 · 원아 ID를 받는다', '월 · 주차 + 원아 ID', '주간계획안 활동 → 학부모 문장', '2026-11-W4 + c1'],
      ['④ 관찰일지', '원아 ID · 영역 태그를 쓴다', '원아 ID + 영역', '주간계획안 활동 + 관찰 내용', 'c1 + 예술경험'],
      ['⑤ 상담일지', '원아 ID로 모두를 모은다', '원아 ID', '관찰일지 + 알림장 기록 집계', 'c1의 누적 기록']
    ];
    var table = rows.map(function (r) {
      return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td><td class="arrow-cell">' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td class="mono">' + esc(r[4]) + '</td></tr>';
    }).join('');

    var dg = [
      { doc: '연간계획안', sub: '설계', keys: [{ t: '월·주차', c: '' }], out: '주제 · 목표' },
      { doc: '주간계획안', sub: '연결', keys: [{ t: '월·주차', c: '' }], out: '요일별 활동 · 가정 연계' },
      { doc: '알림장', sub: '변환', keys: [{ t: '월·주차', c: '' }, { t: '원아 ID', c: 'amber' }], out: '학부모 문장 · 원아별 전달' },
      { doc: '관찰일지', sub: '기록', keys: [{ t: '원아 ID', c: 'amber' }, { t: '영역 태그', c: 'amber' }], out: '관찰 내용' },
      { doc: '상담일지', sub: '집계', keys: [{ t: '원아 ID', c: 'amber' }], out: '영역별 발달 요약 · 상담 포인트' }
    ];
    var diagram = dg.map(function (d) {
      return '<div class="dg-row"><div class="dg-doc">' + esc(d.doc) + '<small>' + esc(d.sub) + '</small></div>'
        + '<div class="dg-keys">' + d.keys.map(function (k) {
          return '<span class="dg-key ' + k.c + '">' + esc(k.t) + '</span>';
        }).join('') + '<span class="dg-key out">→ ' + esc(d.out) + '</span></div></div>';
    }).join('');

    var live = state.children.map(function (c) {
      var o = state.observations.filter(function (x) { return x.childId === c.id; }).length;
      var n = state.notices.filter(function (x) { return x.children && x.children[c.id]; }).length;
      return '<tr><td class="mono">' + esc(c.id) + '</td><td><b>' + esc(c.name) + '</b></td><td>' + o + '건</td><td>' + n + '건</td><td>' + (o + n ? '연결됨' : '기록 없음') + '</td></tr>';
    }).join('');

    return ''
      + '<div class="card card-pad"><span class="eyebrow">연결 구조</span>'
      + '<h2 style="font-size:17px;font-weight:680;margin-top:6px;letter-spacing:-0.02em">다섯 서류는 세 개의 Key로만 이어집니다</h2>'
      + '<p class="hint" style="margin-top:6px">서류를 따로 쓰지 않아도, 같은 Key를 쓰는 순간 앞선 기록이 다음 서류의 재료가 됩니다.</p></div>'
      + '<div class="key-cards">' + keyCards + '</div>'
      + '<div class="section-head"><div><h2>서류별 Key 사용표</h2><p>어떤 서류가 어떤 Key를 만들고 받는지 정리했습니다.</p></div></div>'
      + '<div class="card" style="overflow:hidden"><table class="map-table"><thead><tr>'
      + '<th>서류</th><th>하는 일</th><th>Key</th><th>데이터</th><th>예시 값</th></tr></thead><tbody>' + table + '</tbody></table></div>'
      + '<div class="section-head"><div><h2>데이터 흐름 다이어그램</h2><p>Key가 흐르는 방향을 따라가면 서류가 이어집니다.</p></div></div>'
      + '<div class="diagram">' + diagram + '</div>'
      + '<div class="section-head"><div><h2>현재 연결된 원아 Key</h2><p>지금 저장된 기록 기준입니다.</p></div></div>'
      + '<div class="card" style="overflow:hidden"><table class="map-table"><thead><tr>'
      + '<th>원아 ID</th><th>이름</th><th>관찰일지</th><th>알림장 기록</th><th>상태</th></tr></thead><tbody>' + live + '</tbody></table></div>';
  };

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var a = t.getAttribute('data-action');

    if (a === 'go') { location.hash = '#/' + t.getAttribute('data-route'); return; }
    if (a === 'close-modal') { closeModal(); return; }
    if (a === 'pick-month') { ui.annualMonth = Number(t.getAttribute('data-month')); route(); return; }
    if (a === 'annual-week') {
      var m = Number(t.getAttribute('data-month'));
      var w = Number(t.getAttribute('data-week'));
      setCurrentWeek(m, w);
      return;
    }
    if (a === 'week-pick') {
      var m2 = Number(t.getAttribute('data-month'));
      var w2 = Number(t.getAttribute('data-week'));
      setCurrentWeek(m2, w2);
      return;
    }
    if (a === 'act-add') { openActivity(t.getAttribute('data-day'), null); return; }
    if (a === 'act-edit') { openActivity(t.getAttribute('data-day'), t.getAttribute('data-id')); return; }
    if (a === 'link-notice') { linkWeekToNotice(currentKey()); return; }
    if (a === 'reset') {
      openModal({
        title: '샘플 데이터로 되돌릴까요?',
        sub: '이 브라우저에 저장된 기록이 모두 지워지고 만 5세 햇살반 샘플로 다시 채워집니다.',
        body: '<p class="hint">발표나 시연 전에 초기 상태로 돌리고 싶을 때 사용하세요. 되돌릴 수 없습니다.</p>',
        foot: '<button class="btn btn-outline" data-action="close-modal">취소</button>'
          + '<button class="btn btn-primary" data-action="reset-confirm">초기화</button>'
      });
      return;
    }
    if (a === 'reset-confirm') {
      state = buildSeed(); save(); closeModal();
      ui.obsChild = state.children[0].id; ui.counselChild = state.children[0].id;
      ui.annualMonth = state.meta.currentWeek.month; ui.obsAreas = [];
      route(); toast('샘플 데이터로 초기화했습니다');
      return;
    }
    if (a === 'home-add') {
      var input = $('#home-input');
      if (!input || !input.value.trim()) { toast('가정 연계 안내를 먼저 적어 주세요', 'warn'); return; }
      ensureWeek(currentKey()).homeLink.push(input.value.trim());
      save(); route(); toast('가정 연계 안내를 추가했습니다');
      return;
    }
    if (a === 'home-del') {
      var idx = Number(t.getAttribute('data-i'));
      ensureWeek(currentKey()).homeLink.splice(idx, 1);
      save(); route(); toast('삭제했습니다');
      return;
    }
    if (a === 'act-delete') {
      var id = t.getAttribute('data-id');
      var day = ui.day;
      var wk = ensureWeek(currentKey());
      wk.days[day] = (wk.days[day] || []).filter(function (x) { return x.id !== id; });
      save(); closeModal(); route(); toast('활동을 삭제했습니다');
      return;
    }
    if (a === 'pick-child') {
      var sc = t.getAttribute('data-scope');
      if (sc === 'obs') ui.obsChild = t.getAttribute('data-child');
      else ui.counselChild = t.getAttribute('data-child');
      route();
      return;
    }
    if (a === 'toggle-area') {
      var ar = t.getAttribute('data-area');
      var i2 = ui.obsAreas.indexOf(ar);
      if (i2 >= 0) ui.obsAreas.splice(i2, 1); else ui.obsAreas.push(ar);
      t.classList.toggle('on');
      return;
    }
    if (a === 'pick-activity') {
      var s = $('#obs-activity');
      if (s) { s.value = t.getAttribute('data-title'); }
      var cs = $('#obs-custom'); if (cs) cs.value = '';
      $$('[data-action="pick-activity"]').forEach(function (b) { b.classList.remove('pill-sage'); b.classList.add('pill-line'); });
      t.classList.remove('pill-line');
      t.classList.add('pill-sage');
      return;
    }
    if (a === 'obs-del') {
      var oid = t.getAttribute('data-id');
      state.observations = state.observations.filter(function (o) { return o.id !== oid; });
      save(); route(); toast('관찰일지를 삭제했습니다');
      return;
    }
    if (a === 'notice-save') {
      var n = noticeFor(currentKey());
      if (n) { n.updatedAt = nowISO(); save(); toast('알림장을 저장했습니다'); }
      return;
    }
    if (a === 'regenerate') {
      var nn = noticeFor(currentKey());
      if (!nn) { linkWeekToNotice(currentKey()); return; }
      var gen = generateNotice(currentKey());
      nn.opening = gen.opening; nn.guide = gen.guide; nn.homeLink = gen.homeLink; nn.updatedAt = nowISO();
      save(); route(); toast('주간계획안 기준으로 문장을 다시 만들었습니다');
      return;
    }
    if (a === 'notice-toggle') {
      var n3 = noticeFor(currentKey());
      if (!n3) return;
      n3.status = n3.status === 'sent' ? 'draft' : 'sent';
      n3.updatedAt = nowISO();
      save(); route(); toast(n3.status === 'sent' ? '학부모 발송으로 표시했습니다' : '초안으로 되돌렸습니다');
      return;
    }
    if (a === 'counsel-save') {
      var noteEl = $('#c-note');
      var childId = ui.counselChild;
      var text = noteEl ? noteEl.value.trim() : '';
      var rec = state.counselings.filter(function (s) { return s.childId === childId; })[0];
      if (rec) { rec.teacherNote = text; rec.date = todayStr(); rec.updatedAt = nowISO(); }
      else {
        state.counselings.push({ id: uid('s-'), childId: childId, date: todayStr(), teacherNote: text, updatedAt: nowISO() });
      }
      save(); route(); toast('상담일지를 저장했습니다');
      return;
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'n-opening' || t.id === 'n-guide') {
      var n = noticeFor(currentKey());
      if (!n) return;
      if (t.id === 'n-opening') n.opening = t.value;
      else n.guide = t.value.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      save(); updatePreview();
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-child') && t.hasAttribute('data-field')) {
      var n2 = noticeFor(currentKey());
      if (!n2) return;
      var cid = t.getAttribute('data-child');
      var f = t.getAttribute('data-field');
      if (!n2.children[cid]) n2.children[cid] = { mood: '좋음', meal: '다 먹음', nap: '잘 잤어요', comment: '' };
      n2.children[cid][f] = t.value;
      n2.updatedAt = nowISO();
      save(); updatePreview();
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-child') && t.hasAttribute('data-field')) {
      var n = noticeFor(currentKey());
      if (!n) return;
      var cid = t.getAttribute('data-child');
      if (!n.children[cid]) n.children[cid] = {};
      n.children[cid][t.getAttribute('data-field')] = t.value;
      save(); updatePreview();
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'act-form') {
      e.preventDefault();
      var fd = new FormData(f);
      var id = fd.get('id');
      var day = fd.get('day');
      var key = currentKey();
      var wk = ensureWeek(key);
      var item = {
        id: id || uid('a'),
        title: String(fd.get('title') || '').trim(),
        area: String(fd.get('area') || '자연탐구'),
        detail: String(fd.get('detail') || '').trim(),
        home: String(fd.get('home') || '').trim()
      };
      if (!item.title) return;
      var prevDay = ui.day;
      if (prevDay && prevDay !== day) {
        wk.days[prevDay] = (wk.days[prevDay] || []).filter(function (x) { return x.id !== item.id; });
      }
      wk.days[day] = wk.days[day] || [];
      var at = wk.days[day].map(function (x) { return x.id; }).indexOf(item.id);
      if (at >= 0) wk.days[day][at] = item; else wk.days[day].push(item);
      save(); closeModal(); route(); toast('놀이 활동을 저장했습니다');
      return;
    }
    if (f.id === 'obs-form') {
      e.preventDefault();
      var fd2 = new FormData(f);
      var actSel = String(fd2.get('activity') || '');
      var custom = String(fd2.get('activityCustom') || '').trim();
      var activity = custom || (actSel === '__custom' ? '' : actSel);
      if (!activity) { toast('놀이 활동을 고르거나 직접 입력해 주세요', 'warn'); return; }
      if (!ui.obsAreas.length) { toast('누리과정 영역을 하나 이상 태그해 주세요', 'warn'); return; }
      var content = String(fd2.get('content') || '').trim();
      if (!content) { toast('관찰 내용을 적어 주세요', 'warn'); return; }
      state.observations.push({
        id: uid('o-'), childId: String(fd2.get('childId')), weekKey: currentKey(),
        activity: activity, areas: ui.obsAreas.slice(), content: content,
        date: String(fd2.get('date') || todayStr())
      });
      save();
      ui.obsAreas = [];
      route();
      toast('관찰일지를 저장했습니다 · 상담일지에 반영됩니다');
      return;
    }
  });

  $('#overlay').addEventListener('click', function (e) {
    if (e.target.id === 'overlay') closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#overlay').hidden) closeModal();
  });

  window.addEventListener('hashchange', route);

  /* ---------------- start ---------------- */
  boot();
  if (!location.hash) {
    location.hash = '#/home';
  } else {
    route();
  }
  var stamp = $('#foot-stamp');
  if (stamp) stamp.textContent = '브라우저 저장소 · 샘플 ' + state.meta.class.name;
})();
