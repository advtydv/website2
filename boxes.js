// Enables dragging and resizing of .edgeless-content-block elements
// Blocks are constrained so they cannot overlap the navigation bar
// or the fixed left animation column.

document.addEventListener('DOMContentLoaded', () => {
    const blocks = document.querySelectorAll('.edgeless-content-block');
    const nav = document.querySelector('.navbar');
    const leftSidebar = document.querySelector('.left-sidebar-fixed-animation');

    const topLimit = nav ? nav.getBoundingClientRect().bottom + window.scrollY : 0;
    const leftLimit = leftSidebar ? leftSidebar.getBoundingClientRect().right + window.scrollX : 0;

    blocks.forEach(block => {
        // capture initial layout then switch to absolute positioning
        const rect = block.getBoundingClientRect();
        block.style.position = 'absolute';
        block.style.top = rect.top + window.scrollY + 'px';
        block.style.left = rect.left + window.scrollX + 'px';
        block.style.width = rect.width + 'px';
        block.classList.add('draggable');

        addResizers(block);
        enableDrag(block);
    });

    function enableDrag(el) {
        let startX, startY, startLeft, startTop, dragging = false;
        el.addEventListener('mousedown', e => {
            if (e.target.classList.contains('resizer')) return; // ignore when resizing
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseFloat(el.style.left);
            startTop = parseFloat(el.style.top);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', stopDrag);
        });

        function onMove(e) {
            if (!dragging) return;
            let newLeft = startLeft + e.clientX - startX;
            let newTop = startTop + e.clientY - startY;
            // bounds
            newLeft = Math.max(leftLimit, Math.min(newLeft, window.innerWidth - el.offsetWidth));
            newTop = Math.max(topLimit, Math.min(newTop, document.body.scrollHeight - el.offsetHeight));
            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
        }

        function stopDrag() {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', stopDrag);
        }
    }

    function addResizers(el) {
        const corners = ['nw','ne','sw','se'];
        corners.forEach(corner => {
            const div = document.createElement('div');
            div.className = 'resizer resizer-' + corner;
            el.appendChild(div);
        });

        let current, startX, startY, startW, startH, startLeft, startTop;
        el.querySelectorAll('.resizer').forEach(rs => {
            rs.addEventListener('mousedown', e => {
                e.stopPropagation();
                current = rs;
                startX = e.clientX;
                startY = e.clientY;
                startW = el.offsetWidth;
                startH = el.offsetHeight;
                startLeft = parseFloat(el.style.left);
                startTop = parseFloat(el.style.top);
                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', stopResize);
            });
        });

        function onResize(e) {
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            let newLeft = startLeft;
            let newTop = startTop;
            let newW = startW;
            let newH = startH;

            if (current.classList.contains('resizer-se')) {
                newW += dx;
                newH += dy;
            } else if (current.classList.contains('resizer-sw')) {
                newW -= dx;
                newLeft += dx;
                newH += dy;
            } else if (current.classList.contains('resizer-ne')) {
                newW += dx;
                newH -= dy;
                newTop += dy;
            } else if (current.classList.contains('resizer-nw')) {
                newW -= dx;
                newLeft += dx;
                newH -= dy;
                newTop += dy;
            }

            // respect limits
            newLeft = Math.max(leftLimit, newLeft);
            newTop = Math.max(topLimit, newTop);
            newW = Math.max(50, Math.min(newW, window.innerWidth - newLeft));
            newH = Math.max(50, Math.min(newH, document.body.scrollHeight - newTop));

            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
            el.style.width = newW + 'px';
            el.style.height = newH + 'px';
        }

        function stopResize() {
            document.removeEventListener('mousemove', onResize);
            document.removeEventListener('mouseup', stopResize);
        }
    }
});
