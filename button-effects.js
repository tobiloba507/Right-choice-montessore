const gsap = window.gsap;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!gsap) {
  console.error('Button hover animations could not start because GSAP did not load.');
} else if (!reduceMotion) {
  document.querySelectorAll('button, [role="button"], a.btn').forEach((button) => {
    const tiltX = gsap.quickTo(button, 'rotationX', { duration: 0.25, ease: 'power2.out' });
    const tiltY = gsap.quickTo(button, 'rotationY', { duration: 0.25, ease: 'power2.out' });

    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch' || button.disabled) return;
      gsap.to(button, {
        y: -4,
        scale: 1.035,
        transformPerspective: 650,
        boxShadow: '0 16px 32px rgba(34, 197, 94, 0.3), 0 0 22px rgba(74, 222, 128, 0.2)',
        duration: 0.28,
        ease: 'back.out(1.7)',
      });
    });

    button.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || button.disabled) return;
      const bounds = button.getBoundingClientRect();
      const horizontalPosition = (event.clientX - bounds.left) / bounds.width - 0.5;
      const verticalPosition = (event.clientY - bounds.top) / bounds.height - 0.5;
      tiltX(verticalPosition * -7);
      tiltY(horizontalPosition * 9);
    });

    const reset = () => {
      gsap.to(button, {
        y: 0,
        scale: 1,
        rotationX: 0,
        rotationY: 0,
        boxShadow: '',
        duration: 0.4,
        ease: 'elastic.out(1, 0.55)',
      });
    };

    button.addEventListener('pointerleave', reset);
    button.addEventListener('focus', () => {
      if (!button.disabled) {
        gsap.to(button, { y: -2, duration: 0.2, ease: 'power2.out' });
      }
    });
    button.addEventListener('blur', reset);
  });
}