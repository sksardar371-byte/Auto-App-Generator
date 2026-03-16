(function () {
  function gradeQuiz(selectedIndex, correctIndex) {
    var ok = Number(selectedIndex) === Number(correctIndex);
    return { passed: ok, score: ok ? 100 : 40 };
  }
  window.LMS_QUIZ = { gradeQuiz: gradeQuiz };
})();