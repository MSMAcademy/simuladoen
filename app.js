(function () {
  const bank = window.QUESTION_BANK || { questions: [] };
  const storageKey = "insurance-sim-history-v1";
  const usageKey = "insurance-sim-question-usage-v1";

  const state = {
    student: "",
    mode: "exam",
    jurisdiction: "GENERAL",
    questions: [],
    index: 0,
    answers: {},
    finished: false,
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

  function selectQuestions(count, includeReview, jurisdiction) {
    const usage = readJson(usageKey, {});
    const pool = bank.questions.filter((q) => {
      const reviewAllowed = includeReview || !q.review;
      const jurisdictionAllowed = jurisdiction === "ALL" || (q.jurisdiction || "GENERAL") === jurisdiction;
      return reviewAllowed && jurisdictionAllowed;
    });
    return shuffle(pool)
      .sort((a, b) => (usage[a.id] || 0) - (usage[b.id] || 0))
      .slice(0, Math.min(count, pool.length));
  }

  function show(screen) {
    [startScreen, quizScreen, resultScreen].forEach((el) => el.classList.add("hidden"));
    screen.classList.remove("hidden");
  }

  function renderStart() {
    $("bankTotal").textContent = bank.totalQuestions || bank.questions.length;
    $("reviewTotal").textContent = bank.reviewCount || bank.questions.filter((q) => q.review).length;
    $("generalTotal").textContent = bank.questions.filter((q) => (q.jurisdiction || "GENERAL") === "GENERAL").length;
    $("maTotal").textContent = bank.questions.filter((q) => q.jurisdiction === "MA").length;
    $("flTotal").textContent = bank.questions.filter((q) => q.jurisdiction === "FL").length;
    renderHistory();
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
        const jurisdiction = { GENERAL: "Gerais", MA: "MA", FL: "FL", ALL: "Todas" }[item.jurisdiction || "GENERAL"];
        return `
          <div class="history-item">
            <div>
              <strong>${escapeHtml(item.student)} · ${item.percent}%</strong>
              <span>${date} · ${item.correct}/${item.total} · ${item.mode === "study" ? "Estudo" : "Prova"} · ${jurisdiction}</span>
            </div>
            <span>${item.wrongCount} erradas</span>
          </div>
        `;
      })
      .join("");
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    const selected = state.answers[q.id];
    const total = state.questions.length;
    const position = state.index + 1;
    const modeLabel = state.mode === "study" ? "Modo Estudo" : "Modo Prova";
    const jurisdictionLabel = { GENERAL: "Questões gerais", MA: "Massachusetts", FL: "Florida", ALL: "Todas as questões" }[state.jurisdiction];

    $("quizMeta").textContent = `${state.student} · ${modeLabel} · ${jurisdictionLabel}`;
    $("questionCounter").textContent = `Questão ${position} de ${total}`;
    $("progressBar").style.width = `${(position / total) * 100}%`;
    $("themeTag").textContent = q.theme || "Tema não identificado";
    $("reviewTag").classList.toggle("hidden", !q.review);
    $("questionText").textContent = q.question;

    $("optionsList").innerHTML = q.options
      .map((option) => {
        const classes = ["option"];
        if (selected === option.label) classes.push("selected");
        if (state.mode === "study" && selected && option.label === q.correctAnswer) classes.push("correct");
        if (state.mode === "study" && selected === option.label && selected !== q.correctAnswer) classes.push("wrong");
        return `
          <button class="${classes.join(" ")}" type="button" data-answer="${option.label}">
            <span class="letter">${option.label}</span>
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
      <p>${escapeHtml(q.explanation || "O material original não trouxe explicação para esta questão.")}</p>
    `;
  }

  function chooseAnswer(answer) {
    const q = state.questions[state.index];
    state.answers[q.id] = answer;
    renderQuestion();
  }

  function finishQuiz() {
    const total = state.questions.length;
    const correct = state.questions.filter((q) => state.answers[q.id] === q.correctAnswer).length;
    const percent = Math.round((correct / total) * 100);
    const missed = state.questions.filter((q) => state.answers[q.id] !== q.correctAnswer);

    const usage = readJson(usageKey, {});
    state.questions.forEach((q) => {
      usage[q.id] = (usage[q.id] || 0) + 1;
    });
    writeJson(usageKey, usage);

    const attempt = {
      student: state.student,
      mode: state.mode,
      jurisdiction: state.jurisdiction,
      date: new Date().toISOString(),
      total,
      correct,
      percent,
      wrongCount: missed.length,
    };
    writeJson(storageKey, [attempt, ...readJson(storageKey, [])].slice(0, 30));

    renderResults(correct, total, percent, missed);
    show(resultScreen);
  }

  function renderResults(correct, total, percent, missed) {
    const jurisdictionLabel = { GENERAL: "Questões gerais", MA: "Massachusetts", FL: "Florida", ALL: "Todas as questões" }[state.jurisdiction];
    $("resultStudent").textContent = `${state.student} · ${state.mode === "study" ? "Modo Estudo" : "Modo Prova"} · ${jurisdictionLabel}`;
    $("finalScore").textContent = `${correct}/${total}`;
    $("finalPercent").textContent = `${percent}% de acerto`;

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
            <div class="mini-track"><div class="mini-bar" style="width:${themePercent}%"></div></div>
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
            <p>${escapeHtml(q.explanation || "O material original não trouxe explicação para esta questão.")}</p>
          </article>
        `;
      })
      .join("");
  }

  function startQuiz(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.student = $("studentName").value.trim();
    state.mode = form.get("mode");
    state.jurisdiction = form.get("jurisdiction");
    state.questions = selectQuestions(Number(form.get("questionCount")), $("includeReview").checked, state.jurisdiction);
    if (!state.questions.length) {
      alert("Não há questões disponíveis para esse filtro.");
      return;
    }
    state.index = 0;
    state.answers = {};
    renderQuestion();
    show(quizScreen);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  $("startForm").addEventListener("submit", startQuiz);
  $("prevQuestion").addEventListener("click", () => {
    state.index = Math.max(0, state.index - 1);
    renderQuestion();
  });
  $("nextQuestion").addEventListener("click", () => {
    state.index = Math.min(state.questions.length - 1, state.index + 1);
    renderQuestion();
  });
  $("finishQuiz").addEventListener("click", finishQuiz);
  $("exitQuiz").addEventListener("click", () => show(startScreen));
  $("newAttempt").addEventListener("click", () => {
    renderStart();
    show(startScreen);
  });
  $("clearHistory").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(usageKey);
    renderHistory();
  });

  renderStart();
})();
