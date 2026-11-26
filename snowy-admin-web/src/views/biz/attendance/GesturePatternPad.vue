<template>
	<div class="gesture-pad-shell" :style="{ width: `${size}px`, height: `${size}px` }">
		<svg
			ref="svgRef"
			viewBox="0 0 300 300"
			class="gesture-svg"
			:class="{ readonly }"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
		>
			<!-- 已连接线段与方向箭头 -->
			<g v-for="seg in segments" :key="seg.key">
				<line
					:x1="seg.x1"
					:y1="seg.y1"
					:x2="seg.x2"
					:y2="seg.y2"
					stroke="#1677ff"
					stroke-width="6"
					stroke-linecap="round"
					opacity="0.88"
				/>
				<polygon :points="seg.arrowPoints" fill="#0958d9" opacity="0.9" />
			</g>

			<!-- 拖拽时的实时牵引虚线 -->
			<line
				v-if="isDragging && lastCenter && pointerPos"
				:x1="lastCenter.x"
				:y1="lastCenter.y"
				:x2="pointerPos.x"
				:y2="pointerPos.y"
				stroke="#1677ff"
				stroke-width="4"
				stroke-dasharray="7 6"
				stroke-linecap="round"
				opacity="0.65"
			/>

			<!-- 九宫格圆点 -->
			<g v-for="dot in DOTS" :key="dot.id">
				<circle
					v-if="ordersOf(dot.id).length > 0"
					:cx="dot.x"
					:cy="dot.y"
					r="28"
					fill="rgba(22, 119, 255, 0.14)"
				/>
				<circle
					:cx="dot.x"
					:cy="dot.y"
					r="21"
					:fill="ordersOf(dot.id).length > 0 ? '#1677ff' : '#fafafa'"
					:stroke="ordersOf(dot.id).length > 0 ? '#0958d9' : '#d9d9d9'"
					stroke-width="2"
				/>
				<text
					:x="dot.x"
					:y="dot.y + 4"
					text-anchor="middle"
					:font-size="ordersOf(dot.id).length > 1 ? 11 : 14"
					font-weight="600"
					:fill="ordersOf(dot.id).length > 0 ? '#ffffff' : '#8c8c8c'"
					style="pointer-events: none; user-select: none"
				>
					{{ badgeText(dot.id) }}
				</text>
			</g>
		</svg>
	</div>
</template>

<script setup name="GesturePatternPad">
	import { computed, ref, watch } from 'vue'

	const MAX_POINTS = 25

	const props = defineProps({
		modelValue: {
			type: String,
			default: ''
		},
		readonly: {
			type: Boolean,
			default: false
		},
		size: {
			type: Number,
			default: 220
		}
	})

	const emit = defineEmits(['update:modelValue', 'change'])

	const DOTS = [
		{ id: '1', x: 50, y: 50 },
		{ id: '2', x: 150, y: 50 },
		{ id: '3', x: 250, y: 50 },
		{ id: '4', x: 50, y: 150 },
		{ id: '5', x: 150, y: 150 },
		{ id: '6', x: 250, y: 150 },
		{ id: '7', x: 50, y: 250 },
		{ id: '8', x: 150, y: 250 },
		{ id: '9', x: 250, y: 250 }
	]
	const DOT_MAP = Object.fromEntries(DOTS.map((d) => [d.id, d]))
	const MID_MAP = {
		'1-3': '2',
		'3-1': '2',
		'1-7': '4',
		'7-1': '4',
		'1-9': '5',
		'9-1': '5',
		'2-8': '5',
		'8-2': '5',
		'3-7': '5',
		'7-3': '5',
		'3-9': '6',
		'9-3': '6',
		'4-6': '5',
		'6-4': '5',
		'7-9': '8',
		'9-7': '8'
	}

	const parsePattern = (val) => {
		const out = []
		for (const ch of String(val || '').match(/[1-9]/g) || []) {
			if (out[out.length - 1] !== ch && out.length < MAX_POINTS) {
				out.push(ch)
			}
		}
		return out
	}

	const svgRef = ref(null)
	const points = ref(parsePattern(props.modelValue))
	const isPointerActive = ref(false)
	const isDragging = ref(false)
	const startPos = ref(null)
	const startDot = ref(null)
	const pointerPos = ref(null)

	watch(
		() => props.modelValue,
		(val) => {
			const parsed = parsePattern(val)
			if (parsed.join('-') !== points.value.join('-')) {
				points.value = parsed
			}
		}
	)

	const emitPoints = (nextPts) => {
		points.value = nextPts
		const pattern = nextPts.join('-')
		emit('update:modelValue', pattern)
		emit('change', pattern)
	}

	const ordersOf = (id) => {
		const res = []
		points.value.forEach((p, idx) => {
			if (p === id) res.push(idx + 1)
		})
		return res
	}

	const badgeText = (id) => {
		const list = ordersOf(id)
		return list.length > 0 ? list.join(',') : id
	}

	const lastCenter = computed(() => {
		if (!points.value.length) return null
		return DOT_MAP[points.value[points.value.length - 1]] || null
	})

	const segments = computed(() => {
		const list = []
		for (let i = 0; i < points.value.length - 1; i++) {
			const a = DOT_MAP[points.value[i]]
			const b = DOT_MAP[points.value[i + 1]]
			if (!a || !b) continue
			const dx = b.x - a.x
			const dy = b.y - a.y
			const len = Math.hypot(dx, dy) || 1
			const ux = dx / len
			const uy = dy / len
			const mx = (a.x + b.x) / 2
			const my = (a.y + b.y) / 2
			const tipX = mx + ux * 6
			const tipY = my + uy * 6
			const baseX = mx - ux * 5
			const baseY = my - uy * 5
			const px = -uy * 5
			const py = ux * 5
			list.push({
				key: `${i}-${a.id}-${b.id}`,
				x1: a.x,
				y1: a.y,
				x2: b.x,
				y2: b.y,
				arrowPoints: `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(baseX + px).toFixed(1)},${(baseY + py).toFixed(1)} ${(baseX - px).toFixed(1)},${(baseY - py).toFixed(1)}`
			})
		}
		return list
	})

	const toSvgCoords = (e) => {
		const el = svgRef.value
		if (!el) return null
		const rect = el.getBoundingClientRect()
		if (!rect.width || !rect.height) return null
		return {
			x: ((e.clientX - rect.left) / rect.width) * 300,
			y: ((e.clientY - rect.top) / rect.height) * 300
		}
	}

	const hitDot = (pos, radius = 32) => {
		if (!pos) return null
		for (const d of DOTS) {
			if (Math.hypot(pos.x - d.x, pos.y - d.y) <= radius) {
				return d.id
			}
		}
		return null
	}

	const appendDotWithBridge = (curPts, nextId) => {
		if (!nextId || curPts.length >= MAX_POINTS || curPts[curPts.length - 1] === nextId) {
			return curPts
		}
		const out = [...curPts]
		if (out.length > 0) {
			const last = out[out.length - 1]
			const mid = MID_MAP[`${last}-${nextId}`]
			if (mid && mid !== last && out.length < MAX_POINTS) {
				out.push(mid)
			}
		}
		if (out[out.length - 1] !== nextId && out.length < MAX_POINTS) {
			out.push(nextId)
		}
		return out
	}

	const onPointerDown = (e) => {
		if (props.readonly || (e.button !== undefined && e.button !== 0)) return
		const pos = toSvgCoords(e)
		if (!pos) return
		try {
			e.currentTarget?.setPointerCapture?.(e.pointerId)
		} catch {}
		isPointerActive.value = true
		isDragging.value = false
		startPos.value = pos
		startDot.value = hitDot(pos, 34)
		pointerPos.value = pos
	}

	const onPointerMove = (e) => {
		if (props.readonly || !isPointerActive.value) return
		const pos = toSvgCoords(e)
		if (!pos) return
		pointerPos.value = pos
		if (!isDragging.value && startPos.value) {
			if (Math.hypot(pos.x - startPos.value.x, pos.y - startPos.value.y) > 10) {
				isDragging.value = true
				const seed = startDot.value ? [startDot.value] : []
				const hit = hitDot(pos, 28)
				const next = hit ? appendDotWithBridge(seed, hit) : seed
				emitPoints(next)
			}
			return
		}
		if (isDragging.value) {
			const hit = hitDot(pos, 28)
			if (hit && hit !== points.value[points.value.length - 1]) {
				emitPoints(appendDotWithBridge(points.value, hit))
			}
		}
	}

	const onPointerUp = () => {
		if (!isPointerActive.value) return
		if (!isDragging.value && startDot.value) {
			const last = points.value[points.value.length - 1]
			if (startDot.value === last) {
				emitPoints(points.value.slice(0, -1))
			} else if (points.value.length < MAX_POINTS) {
				emitPoints([...points.value, startDot.value])
			}
		}
		isPointerActive.value = false
		isDragging.value = false
		startPos.value = null
		startDot.value = null
		pointerPos.value = null
	}

	const onPointerCancel = () => {
		isPointerActive.value = false
		isDragging.value = false
		startPos.value = null
		startDot.value = null
		pointerPos.value = null
	}
</script>

<style scoped>
	.gesture-pad-shell {
		border: 1px solid #e6ebf1;
		border-radius: 10px;
		background: #f9fbfd;
		padding: 6px;
		box-sizing: border-box;
		flex-shrink: 0;
	}
	.gesture-svg {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		user-select: none;
		cursor: crosshair;
	}
	.gesture-svg.readonly {
		cursor: default;
	}
</style>
