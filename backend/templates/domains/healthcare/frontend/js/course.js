(function () {
  function formatCourseCard(course) {
    var c = course || {};
    return '<article class="course-item"><h3>' + (c.title || 'Course') + '</h3><p class="muted">' + (c.category || 'General') + ' | ' + (c.level || 'Beginner') + '</p></article>';
  }
  window.LMS_COURSE = { formatCourseCard: formatCourseCard };
})();