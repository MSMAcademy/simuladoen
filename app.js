(function () {
  const bank = window.QUESTION_BANK || { questions: [] };
  const storageKey = "insurance-sim-history-v1";
  const usageKey = "insurance-sim-question-usage-v1";
  const savedReviewKey = "insurance-sim-saved-review-v1";
  const draftKey = "insurance-sim-draft-v1";

  const state = {
    student: "",
    mode: "study",
    jurisdictions: ["GENERAL"],
    focusMode: "all",
    selectedThemes: [],
    questions: [],
    index: 0,
    answers: {},
    finished: false,
    expandedHistory: null,
    lastMissedIds: [],
    timerId: null,
    timerSeconds: 0,
    timeExpired: false,
  };

  const $ = (id) => document.getElementById(id);

  const startScreen = $("startScreen");
  const quizScreen = $("quizScreen");
  const resultScreen = $("resultScreen");

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }


  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getSelectedJurisdictions() {
    return [...document.querySelectorAll('input[name="jurisdictions"]:checked')].map((item) => item.value);
  }

  function getWrongCounts() {
    const counts = {};
    readJson(storageKey, []).forEach((attempt) => {
      (attempt.missed || []).forEach((missed) => {
        counts[missed.id] = (counts[missed.id] || 0) + 1;
      });
    });
    return counts;
  }

  function getSavedReviewSet() {
    return new Set(readJson(savedReviewKey, []));
  }

  function writeSavedReviewSet(items) {
    writeJson(savedReviewKey, [...items]);
  }

  function getFocusMode() {
    return document.querySelector('input[name="focusMode"]:checked')?.value || "all";
  }

  function questionMatchesFocus(q, focusMode, wrongCounts, savedReviewSet) {
    if (focusMode === "wrong") return (wrongCounts[q.id] || 0) > 0;
    if (focusMode === "saved") return savedReviewSet.has(q.id);
    return true;
  }

  function selectQuestions(count, jurisdictions, selectedThemes, focusMode) {
    const usage = readJson(usageKey, {});
    const wrongCounts = getWrongCounts();
    const savedReviewSet = getSavedReviewSet();
    const pool = bank.questions.filter((q) => {
      const jurisdictionAllowed = jurisdictions.includes(q.jurisdiction || "GENERAL");
      const themeAllowed = !selectedThemes.length || selectedThemes.includes(q.theme || "Tema não identificado");
      const focusAllowed = questionMatchesFocus(q, focusMode, wrongCounts, savedReviewSet);
      return jurisdictionAllowed && themeAllowed && focusAllowed;
    });
    return shuffle(pool)
      .sort((a, b) => {
        if (focusMode === "wrong") {
          return (wrongCounts[b.id] || 0) - (wrongCounts[a.id] || 0) || (usage[a.id] || 0) - (usage[b.id] || 0);
        }
        return (usage[a.id] || 0) - (usage[b.id] || 0);
      })
      .slice(0, Math.min(count, pool.length));
  }

  function show(screen) {
    [startScreen, quizScreen, resultScreen].forEach((el) => el.classList.add("hidden"));
    screen.classList.remove("hidden");
  }

  function getExamSeconds(questionCount) {
    const minutesByCount = { 25: 30, 50: 60, 100: 120 };
    return (minutesByCount[questionCount] || Math.ceil(questionCount * 1.2)) * 60;
  }

  function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function renderTimer() {
    const timerBox = $("timerBox");
    const showTimer = state.mode === "exam" && state.timerSeconds > 0;
    timerBox.classList.toggle("hidden", !showTimer);
    timerBox.classList.toggle("timer-warning", state.timerSeconds > 0 && state.timerSeconds <= 300);
    timerBox.textContent = formatTimer(Math.max(0, state.timerSeconds));
  }

  function startTimer(questionCount) {
    stopTimer();
    state.timeExpired = false;
    if (state.mode !== "exam") {
      state.timerSeconds = 0;
      renderTimer();
      return;
    }
    state.timerSeconds = getExamSeconds(questionCount);
    renderTimer();
    state.timerId = setInterval(() => {
      state.timerSeconds -= 1;
      renderTimer();
      if (state.timerSeconds <= 0) {
        stopTimer();
        state.timeExpired = true;
        finishQuiz();
      }
    }, 1000);
  }

  function resumeTimer() {
    stopTimer();
    if (state.mode !== "exam" || state.timerSeconds <= 0) {
      renderTimer();
      return;
    }
    renderTimer();
    state.timerId = setInterval(() => {
      state.timerSeconds -= 1;
      renderTimer();
      if (state.timerSeconds <= 0) {
        stopTimer();
        state.timeExpired = true;
        localStorage.removeItem(draftKey);
        finishQuiz();
      }
    }, 1000);
  }

  function renderStart() {
    renderThemeFilter();
    renderResumeBox();
    renderHistory();
  }

  function renderResumeBox() {
    const draft = readJson(draftKey, null);
    const box = $("resumeBox");
    if (!draft || !draft.questions?.length) {
      box.classList.add("hidden");
      $("resumeInfo").textContent = "";
      return;
    }
    const answered = Object.keys(draft.answers || {}).length;
    const total = draft.questions.length;
    const mode = draft.mode === "exam" ? "Prova" : "Estudo";
    const date = new Date(draft.savedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const timer = draft.mode === "exam" && draft.timerSeconds > 0 ? ` · ${formatTimer(draft.timerSeconds)} restantes` : "";
    $("resumeInfo").textContent = `${answered}/${total} respondidas · ${mode} · salvo em ${date}${timer}`;
    box.classList.remove("hidden");
  }

  function getFilteredPoolForThemeCounts() {
    const jurisdictions = getSelectedJurisdictions();
    const focusMode = getFocusMode();
    const wrongCounts = getWrongCounts();
    const savedReviewSet = getSavedReviewSet();
    return bank.questions.filter((q) => {
      const jurisdictionAllowed = jurisdictions.includes(q.jurisdiction || "GENERAL");
      const focusAllowed = questionMatchesFocus(q, focusMode, wrongCounts, savedReviewSet);
      return jurisdictionAllowed && focusAllowed;
    });
  }

  function renderThemeFilter() {
    const pool = getFilteredPoolForThemeCounts();
    const counts = {};
    pool.forEach((q) => {
      const theme = q.theme || "Tema não identificado";
      counts[theme] = (counts[theme] || 0) + 1;
    });
    const selected = new Set([...document.querySelectorAll('input[name="themes"]:checked')].map((item) => item.value));
    $("themeFilter").innerHTML = Object.entries(counts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([theme, count]) => `
        <label class="theme-choice">
          <input type="checkbox" name="themes" value="${escapeHtml(theme)}" ${selected.has(theme) ? "checked" : ""} />
          <span>${escapeHtml(theme)} (${count})</span>
        </label>
      `)
      .join("");
  }

  function renderHistory() {
    const history = readJson(storageKey, []);
    const list = $("historyList");
    if (!history.length) {
      list.className = "history-list empty";
      list.textContent = "Nenhuma tentativa registrada neste navegador.";
      return;
    }
    list.className = "history-list";
    list.innerHTML = history
      .slice(0, 8)
      .map((item) => {
        const date = new Date(item.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        const jurisdiction = formatJurisdictions(item.jurisdictions || [item.jurisdiction || "GENERAL"]);
        return `
          <div class="history-item">
            <div>
              <strong>${escapeHtml(item.student || "Sem obs.")} · ${item.percent}%</strong>
              <span>${date} · ${item.correct}/${item.total} · ${item.mode === "study" ? "Estudo" : "Prova"} · ${jurisdiction}</span>
            </div>
            <div class="history-score" aria-label="Desempenho ${item.percent}%">
              <div class="history-track">
                <div class="history-bar ${getScoreClass(item.percent)}" style="width:${Math.max(0, Math.min(100, item.percent))}%"></div>
              </div>
              <strong>${item.percent}%</strong>
            </div>
            <div class="history-actions">
              <span>${item.wrongCount} erradas</span>
              ${item.wrongCount ? `<button class="small-button" type="button" data-retry-history-id="${item.id || item.date}">Refazer</button>` : '<span class="button-spacer" aria-hidden="true"></span>'}
              <button class="small-button" type="button" data-history-id="${item.id || item.date}">Ver erros</button>
            </div>
          </div>
          ${state.expandedHistory === (item.id || item.date) ? renderHistoryDetail(item) : ""}
        `;
      })
      .join("");
  }

  function renderHistoryDetail(item) {
    if (!item.missed || !item.missed.length) {
      return `<div class="history-detail"><p>Nenhuma questão errada salva nesta tentativa.</p></div>`;
    }
    return `
      <div class="history-detail">
        <h3>Questões erradas desta tentativa</h3>
        <div class="history-missed">
          ${item.missed
            .map((missed) => {
              const q = bank.questions.find((question) => question.id === missed.id);
              if (!q) return "";
              const correctText = q.options.find((o) => o.label === q.correctAnswer)?.text || "";
              return `
                <article>
                  <p><strong>${escapeHtml(q.id)}.</strong> ${escapeHtml(q.question)}</p>
                  <p class="answer-line">Sua resposta: ${escapeHtml(missed.answer || "sem resposta")} · Correta: ${escapeHtml(q.correctAnswer)} — ${escapeHtml(correctText)}</p>
                  ${renderExplanation(q)}
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    const selected = state.answers[q.id];
    const savedReviewSet = getSavedReviewSet();
    const isSavedForReview = savedReviewSet.has(q.id);
    const total = state.questions.length;
    const position = state.index + 1;
    const modeLabel = state.mode === "study" ? "Modo Estudo" : "Modo Prova";
    const jurisdictionLabel = formatJurisdictions(state.jurisdictions);

    $("quizMeta").textContent = `${state.student || "Sem obs."} · ${modeLabel} · ${jurisdictionLabel}`;
    $("questionCounter").textContent = `Questão ${position} de ${total}`;
    $("progressBar").style.width = `${(position / total) * 100}%`;
    $("themeTag").textContent = q.theme || "Tema não identificado";
    $("reviewTag").classList.toggle("hidden", !q.review);
    $("savedReviewTag").classList.toggle("hidden", !isSavedForReview);
    $("toggleSavedReview").textContent = isSavedForReview ? "Remover revisão" : "Marcar para revisar";
    renderTimer();
    $("questionText").textContent = q.question;

    $("optionsList").innerHTML = q.options
      .map((option) => {
        const classes = ["option"];
        if (selected === option.label) classes.push("selected");
        if (state.mode === "study" && selected && option.label === q.correctAnswer) classes.push("correct");
        if (state.mode === "study" && selected === option.label && selected !== q.correctAnswer) classes.push("wrong");
        return `
          <button class="${classes.join(" ")}" type="button" data-answer="${option.label}">
            <span class="letter">${option.label}.</span>
            <span>${escapeHtml(option.text)}</span>
          </button>
        `;
      })
      .join("");

    $("optionsList").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => chooseAnswer(button.dataset.answer));
    });

    renderFeedback(q, selected);
    $("prevQuestion").disabled = state.index === 0;
    $("nextQuestion").classList.toggle("hidden", state.index === total - 1);
    $("finishQuiz").classList.toggle("hidden", state.index !== total - 1);
  }

  function renderFeedback(q, selected) {
    const box = $("feedbackBox");
    if (state.mode !== "study" || !selected) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const correct = selected === q.correctAnswer;
    box.classList.remove("hidden");
    box.innerHTML = `
      <strong>${correct ? "Correto." : "Resposta correta: " + (q.correctAnswer || "não identificada") + "."}</strong>
      ${q.review ? "<p>Esta questão foi sinalizada para revisão por inconsistência ou incompletude aparente no material original.</p>" : ""}
      ${renderExplanation(q)}
    `;
  }

  function chooseAnswer(answer) {
    const q = state.questions[state.index];
    state.answers[q.id] = answer;
    renderQuestion();
  }

  function toggleSavedReview() {
    const q = state.questions[state.index];
    if (!q) return;
    const savedReviewSet = getSavedReviewSet();
    if (savedReviewSet.has(q.id)) {
      savedReviewSet.delete(q.id);
    } else {
      savedReviewSet.add(q.id);
    }
    writeSavedReviewSet(savedReviewSet);
    const isSavedForReview = savedReviewSet.has(q.id);
    $("savedReviewTag").classList.toggle("hidden", !isSavedForReview);
    $("toggleSavedReview").textContent = isSavedForReview ? "Remover revisão" : "Marcar para revisar";
    renderQuestion();
    renderThemeFilter();
    renderHistory();
  }

  function finishQuiz() {
    stopTimer();
    localStorage.removeItem(draftKey);
    const total = state.questions.length;
    const correct = state.questions.filter((q) => state.answers[q.id] === q.correctAnswer).length;
    const percent = Math.round((correct / total) * 100);
    const missed = state.questions.filter((q) => state.answers[q.id] !== q.correctAnswer);
    state.lastMissedIds = missed.map((q) => q.id);

    const usage = readJson(usageKey, {});
    state.questions.forEach((q) => {
      usage[q.id] = (usage[q.id] || 0) + 1;
    });
    writeJson(usageKey, usage);

    const attempt = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      student: state.student,
      mode: state.mode,
      jurisdictions: state.jurisdictions,
      themes: state.selectedThemes,
      date: new Date().toISOString(),
      total,
      correct,
      percent,
      wrongCount: missed.length,
      timeExpired: state.timeExpired,
      missed: missed.map((q) => ({ id: q.id, answer: state.answers[q.id] || "" })),
    };
    writeJson(storageKey, [attempt, ...readJson(storageKey, [])].slice(0, 30));

    renderResults(correct, total, percent, missed);
    show(resultScreen);
  }

  function renderResults(correct, total, percent, missed) {
    const jurisdictionLabel = formatJurisdictions(state.jurisdictions);
    const timeLabel = state.timeExpired ? " · Tempo esgotado" : "";
    $("resultStudent").textContent = `${state.student || "Sem obs."} · ${state.mode === "study" ? "Modo Estudo" : "Modo Prova"} · ${jurisdictionLabel}${timeLabel}`;
    $("finalScore").textContent = `${correct}/${total}`;
    $("finalPercent").textContent = `${percent}% de acerto`;
    $("retryMissed").disabled = !missed.length;

    const byTheme = {};
    state.questions.forEach((q) => {
      const theme = q.theme || "Tema não identificado";
      byTheme[theme] ||= { total: 0, correct: 0 };
      byTheme[theme].total += 1;
      if (state.answers[q.id] === q.correctAnswer) byTheme[theme].correct += 1;
    });

    $("themePerformance").innerHTML = Object.entries(byTheme)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([theme, item]) => {
        const themePercent = Math.round((item.correct / item.total) * 100);
        return `
          <div class="theme-row">
            <div class="theme-row-top">
              <span>${escapeHtml(theme)}</span>
              <span>${item.correct}/${item.total} · ${themePercent}%</span>
            </div>
            <div class="mini-track"><div class="mini-bar ${getScoreClass(themePercent)}" style="width:${themePercent}%"></div></div>
          </div>
        `;
      })
      .join("");

    if (!missed.length) {
      $("missedQuestions").innerHTML = "<p>Nenhuma questão errada nesta tentativa.</p>";
      return;
    }

    $("missedQuestions").innerHTML = missed
      .map((q) => {
        const userAnswer = state.answers[q.id] || "sem resposta";
        const correctText = q.options.find((o) => o.label === q.correctAnswer)?.text || "não identificada no material";
        return `
          <article class="missed-item">
            <span class="tag">${escapeHtml(q.theme || "Tema não identificado")}</span>
            ${q.review ? '<span class="tag review">Revisar</span>' : ""}
            <p><strong>${q.id}.</strong> ${escapeHtml(q.question)}</p>
            <p class="answer-line">Sua resposta: ${escapeHtml(userAnswer)} · Correta no material: ${escapeHtml(q.correctAnswer || "não identificada")} — ${escapeHtml(correctText)}</p>
            ${renderExplanation(q)}
          </article>
        `;
      })
      .join("");
  }

  function renderExplanation(q) {
    const en = q.explanation || "O material original não trouxe explicação para esta questão.";
    const pt = q.explanationPt || "";
    return `
      <div class="explanation-block">
        <p><strong>English:</strong> ${escapeHtml(en)}</p>
        ${pt ? `<p><strong>Português:</strong> ${escapeHtml(pt)}</p>` : ""}
      </div>
    `;
  }

  function startQuiz(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.student = $("studentName").value.trim();
    state.mode = form.get("mode");
    state.jurisdictions = getSelectedJurisdictions();
    state.focusMode = form.get("focusMode") || "all";
    if (!state.jurisdictions.length) {
      alert("Selecione pelo menos um grupo de questões: Gerais, MA ou FL.");
      return;
    }
    state.selectedThemes = [...document.querySelectorAll('input[name="themes"]:checked')].map((item) => item.value);
    state.questions = selectQuestions(Number(form.get("questionCount")), state.jurisdictions, state.selectedThemes, state.focusMode);
    if (!state.questions.length) {
      const focusMessage = state.focusMode === "wrong"
        ? "Ainda não há questões erradas no histórico para esse filtro."
        : state.focusMode === "saved"
          ? "Ainda não há questões salvas para revisar nesse filtro."
          : "Não há questões disponíveis para esse filtro.";
      alert(focusMessage);
      return;
    }
    state.index = 0;
    state.answers = {};
    startTimer(state.questions.length);
    renderQuestion();
    show(quizScreen);
  }

  function retryMissedQuestions() {
    const missedIds = new Set(state.lastMissedIds);
    const questions = state.questions.filter((q) => missedIds.has(q.id));
    if (!questions.length) return;
    startQuestionSet(questions, "study");
  }

  function retryHistoryMissed(historyId) {
    const attempt = readJson(storageKey, []).find((item) => (item.id || item.date) === historyId);
    const missedIds = new Set((attempt?.missed || []).map((item) => item.id));
    const questions = bank.questions.filter((q) => missedIds.has(q.id));
    if (!questions.length) return;
    state.student = attempt.student || "";
    state.jurisdictions = attempt.jurisdictions || [attempt.jurisdiction || "GENERAL"];
    startQuestionSet(questions, "study");
  }

  function startQuestionSet(questions, mode) {
    state.questions = shuffle(questions);
    state.index = 0;
    state.answers = {};
    state.mode = mode;
    startTimer(state.questions.length);
    renderQuestion();
    show(quizScreen);
  }

  function saveProgress() {
    if (!state.questions.length) return;
    const draft = {
      student: state.student,
      mode: state.mode,
      jurisdictions: state.jurisdictions,
      focusMode: state.focusMode,
      selectedThemes: state.selectedThemes,
      questions: state.questions.map((q) => q.id),
      index: state.index,
      answers: state.answers,
      timerSeconds: state.timerSeconds,
      timeExpired: state.timeExpired,
      savedAt: new Date().toISOString(),
    };
    writeJson(draftKey, draft);
    stopTimer();
    renderStart();
    show(startScreen);
  }

  function resumeProgress() {
    const draft = readJson(draftKey, null);
    if (!draft || !draft.questions?.length) return;
    const questionMap = new Map(bank.questions.map((q) => [q.id, q]));
    const questions = draft.questions.map((id) => questionMap.get(id)).filter(Boolean);
    if (!questions.length) {
      localStorage.removeItem(draftKey);
      renderResumeBox();
      return;
    }
    state.student = draft.student || "";
    state.mode = draft.mode || "study";
    state.jurisdictions = draft.jurisdictions || ["GENERAL"];
    state.focusMode = draft.focusMode || "all";
    state.selectedThemes = draft.selectedThemes || [];
    state.questions = questions;
    state.index = Math.min(draft.index || 0, questions.length - 1);
    state.answers = draft.answers || {};
    state.timerSeconds = draft.timerSeconds || 0;
    state.timeExpired = Boolean(draft.timeExpired);
    resumeTimer();
    renderQuestion();
    show(quizScreen);
  }

  function discardProgress() {
    localStorage.removeItem(draftKey);
    renderResumeBox();
  }

  function printResult() {
    $("printReport").innerHTML = buildResultReportHtml();
    window.print();
  }

  function buildResultReportHtml() {
    const date = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const meta = $("resultStudent").textContent || "";
    const score = $("finalScore").textContent || "";
    const percent = $("finalPercent").textContent || "";
    const themeRows = buildThemeReportRows();
    const missed = $("missedQuestions").innerHTML || "<p>Nenhuma questão errada nesta tentativa.</p>";
    return `
      <header>
        <h1>Resultado do Simulado</h1>
        <div class="meta">${escapeHtml(meta)} · exportado em ${date}</div>
      </header>
      <section class="score-summary">
        <span class="big">${escapeHtml(score)}</span>
        <span>${escapeHtml(percent)}</span>
      </section>
      <section>
        <h2>Desempenho por tema</h2>
        <div class="theme-performance">${themeRows}</div>
      </section>
      <section>
        <h2>Questões erradas</h2>
        <div class="missed-list">${missed}</div>
      </section>
    `;
  }

  function buildThemeReportRows() {
    const byTheme = {};
    state.questions.forEach((q) => {
      const theme = q.theme || "Tema não identificado";
      byTheme[theme] ||= { total: 0, correct: 0 };
      byTheme[theme].total += 1;
      if (state.answers[q.id] === q.correctAnswer) byTheme[theme].correct += 1;
    });
    return Object.entries(byTheme)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([theme, item]) => {
        const themePercent = Math.round((item.correct / item.total) * 100);
        return `
          <div class="theme-row">
            <div class="theme-row-top">
              <span>${escapeHtml(theme)}</span>
              <span>${item.correct}/${item.total} · ${themePercent}%</span>
            </div>
            <div class="mini-track"><div class="mini-bar ${getScoreClass(themePercent)}" style="width:${themePercent}%"></div></div>
          </div>
        `;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatJurisdictions(jurisdictions) {
    const labels = { GENERAL: "Gerais", MA: "MA", FL: "FL" };
    return jurisdictions.map((item) => labels[item] || item).join(" + ");
  }

  function getScoreClass(percent) {
    if (percent >= 70) return "score-good";
    if (percent >= 50) return "score-warning";
    return "score-low";
  }

  $("startForm").addEventListener("submit", startQuiz);
  $("startForm").addEventListener("change", (event) => {
    if (event.target.name === "jurisdictions" || event.target.name === "focusMode") {
      renderThemeFilter();
    }
  });
  $("prevQuestion").addEventListener("click", () => {
    state.index = Math.max(0, state.index - 1);
    renderQuestion();
  });
  $("nextQuestion").addEventListener("click", () => {
    state.index = Math.min(state.questions.length - 1, state.index + 1);
    renderQuestion();
  });
  $("finishQuiz").addEventListener("click", finishQuiz);
  $("saveProgress").addEventListener("click", saveProgress);
  $("resumeAttempt").addEventListener("click", resumeProgress);
  $("discardAttempt").addEventListener("click", discardProgress);
  $("printResult").addEventListener("click", printResult);
  $("retryMissed").addEventListener("click", retryMissedQuestions);
  $("exitQuiz").addEventListener("click", () => {
    stopTimer();
    show(startScreen);
  });
  $("newAttempt").addEventListener("click", () => {
    renderStart();
    show(startScreen);
  });
  $("clearHistory").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(usageKey);
    localStorage.removeItem(savedReviewKey);
    localStorage.removeItem(draftKey);
    renderHistory();
    renderThemeFilter();
    renderResumeBox();
  });
  $("clearThemes").addEventListener("click", () => {
    document.querySelectorAll('input[name="themes"]').forEach((item) => {
      item.checked = false;
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#toggleSavedReview")) {
      toggleSavedReview();
      return;
    }

    const retryButton = event.target.closest("[data-retry-history-id]");
    if (retryButton) {
      retryHistoryMissed(retryButton.dataset.retryHistoryId);
      return;
    }

    const button = event.target.closest("[data-history-id]");
    if (!button) return;
    state.expandedHistory = state.expandedHistory === button.dataset.historyId ? null : button.dataset.historyId;
    renderHistory();
  });

  renderStart();
})();
