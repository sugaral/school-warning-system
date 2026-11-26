<template>
	<a-drawer
		v-model:open="visible"
		:title="`课堂多模式签到看板 — ${qrState.courseName || ''}（${qrState.className || ''}）`"
		width="980"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-row :gutter="16">
			<a-col :xs="24" :md="10">
				<a-card title="实时签到控制与动态二维码" size="small" :loading="loadingQr">
					<div style="margin-bottom: 10px">
						<span style="color: #666; font-size: 12px; margin-right: 6px">已启用方式：</span>
						<a-tag v-for="m in (qrState.checkinModes || ['qr'])" :key="m" color="blue">{{ modeLabel(m) }}</a-tag>
					</div>

					<div v-if="hasMode('qr')" style="text-align: center; padding: 8px 0">
						<a-qrcode
							v-if="qrState.qrContent"
							:value="qrState.qrContent"
							:size="210"
							:bordered="false"
							style="margin: 0 auto"
						/>
						<a-empty v-else description="暂无二维码数据" />
						<div style="margin-top: 8px">
							<a-tag color="blue">动态口令：{{ qrState.scanToken || '-' }}</a-tag>
						</div>
						<div style="margin-top: 6px; color: #666; font-size: 12px">
							刷新周期：{{ qrState.qrRefreshSeconds || '-' }} 秒 ｜ 下次刷新倒计时：
							<b style="color: #1677ff">{{ localCountdown }}</b> 秒
						</div>
						<div v-if="qrState.status === 'active' && hasPerm('bizAttendanceQr')" style="margin-top: 10px">
							<a-space>
								<span>自定义刷新(秒):</span>
								<a-input-number v-model:value="customRefreshSec" :min="5" :max="3600" size="small" style="width: 85px" />
								<a-button size="small" :loading="savingConfig" @click="applyRefreshConfig">应用并换码</a-button>
							</a-space>
						</div>
					</div>

					<div v-if="hasMode('gesture')" style="margin-top: 8px; padding: 10px; background: #f6ffed; border-radius: 6px; font-size: 12px">
						<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px">
							<span>手势签到图案：<b>{{ qrState.gesturePattern || '未设置' }}</b></span>
							<a-button
								v-if="qrState.status === 'active' && hasPerm('bizAttendanceQr')"
								size="small"
								@click="openGestureEditModal"
							>
								修改手势图案
							</a-button>
						</div>
						<div style="display: flex; justify-content: center">
							<GesturePatternPad :model-value="qrState.gesturePattern || ''" :readonly="true" :size="168" />
						</div>
					</div>
					<div v-if="hasMode('location')" style="margin-top: 6px; padding: 8px; background: #e6f4ff; border-radius: 6px; font-size: 12px">
						定位围栏：{{ qrState.locationName || '教室' }}（半径 {{ qrState.locationRadiusMeters ?? 150 }} 米）
					</div>
					<div v-if="hasMode('photo')" style="margin-top: 6px; padding: 8px; background: #fff7e6; border-radius: 6px; font-size: 12px">
						拍照要求：{{ qrState.photoTip || '请拍摄课堂现场照片' }}
					</div>

					<div style="text-align: center; margin-top: 14px">
						<a-space wrap>
							<a-button
								v-if="qrState.status === 'active' && hasPerm('bizAttendanceQr')"
								type="primary"
								:loading="rotating"
								@click="handleRotateQr"
							>
								立即刷新二维码(旧码作废)
							</a-button>
							<a-button @click="refreshAll">刷新数据</a-button>
							<a-popconfirm
								v-if="qrState.status === 'active' && hasPerm('bizAttendanceEnd')"
								title="确定立即结课并判定未签到学生为缺勤？"
								@confirm="handleEndSession"
							>
								<a-button danger>提前结课</a-button>
							</a-popconfirm>
						</a-space>
					</div>
					<a-divider style="margin: 12px 0" />
					<a-row :gutter="8" style="text-align: center">
						<a-col :span="8"><a-statistic title="应到" :value="qrState.totalStudents ?? 0" /></a-col>
						<a-col :span="8"><a-statistic title="已签" :value="qrState.checkedInCount ?? 0" value-style="color: #3f8600" /></a-col>
						<a-col :span="8"><a-statistic title="请假/缺勤" :value="`${qrState.leaveCount ?? 0}/${qrState.absentCount ?? 0}`" /></a-col>
					</a-row>
				</a-card>
			</a-col>
			<a-col :xs="24" :md="14">
				<a-card title="班级实时花名册状态" size="small" :loading="loadingRoster">
					<a-table
						:columns="rosterColumns"
						:data-source="rosterList"
						row-key="studentId"
						size="small"
						:pagination="{ pageSize: 10 }"
					>
						<template #bodyCell="{ column, record }">
							<template v-if="column.dataIndex === 'status'">
								<a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
							</template>
							<template v-if="column.dataIndex === 'checkinMode'">
								<a-tag v-if="record.checkinMode" color="geekblue">{{ modeLabel(record.checkinMode) }}</a-tag>
								<span v-else style="color: #999">-</span>
							</template>
							<template v-if="column.dataIndex === 'evidence'">
								<a v-if="record.photoFileId" @click="previewPhoto(record.photoFileId)">查看照片</a>
								<span v-else-if="record.distanceMeters != null">{{ record.distanceMeters }}米</span>
								<span v-else style="color: #999">-</span>
							</template>
							<template v-if="column.dataIndex === 'action'">
								<a-select
									v-if="hasPerm('bizAttendanceRoster')"
									:value="record.status"
									size="small"
									style="width: 92px"
									@change="(val) => onStatusChange(record, val)"
								>
									<a-select-option value="on_time">准时</a-select-option>
									<a-select-option value="late">迟到</a-select-option>
									<a-select-option value="leave">请假</a-select-option>
									<a-select-option value="absent">缺勤</a-select-option>
									<a-select-option value="early_leave">早退</a-select-option>
								</a-select>
							</template>
						</template>
					</a-table>
				</a-card>
			</a-col>
		</a-row>
		<a-modal v-model:open="photoModalVisible" title="学生拍照签到凭证" :footer="null" width="420">
			<img v-if="photoPreviewUrl" :src="photoPreviewUrl" style="width: 100%; border-radius: 6px" />
		</a-modal>
		<a-modal
			v-model:open="gestureEditVisible"
			title="自定义修改手势签到连线（至少 4 个点）"
			:confirm-loading="savingGesture"
			width="420"
			@ok="applyGestureConfig"
		>
			<div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 6px 0">
				<GesturePatternPad v-model="editGesturePattern" :size="230" />
				<div>当前序列：<b>{{ editGesturePattern || '请拖动连线或逐点点击' }}</b></div>
				<a-space>
					<a-button size="small" :disabled="!editGesturePattern" @click="undoEditGesture">撤销一步</a-button>
					<a-button size="small" :disabled="!editGesturePattern" @click="editGesturePattern = ''">清空重画</a-button>
				</a-space>
			</div>
		</a-modal>
	</a-drawer>
</template>

<script setup name="bizAttendanceSignInBoard">
	import { message } from 'ant-design-vue'
	import bizAttendanceApi from '@/api/biz/bizAttendanceApi'
	import fileApi from '@/api/dev/fileApi'
	import GesturePatternPad from './GesturePatternPad.vue'

	const emit = defineEmits({ updated: null })

	const rosterColumns = [
		{ title: '学号', dataIndex: 'studentNo', width: 120 },
		{ title: '姓名', dataIndex: 'studentName', width: 90 },
		{ title: '状态', dataIndex: 'status', width: 78 },
		{ title: '方式', dataIndex: 'checkinMode', width: 82 },
		{ title: '凭证/距离', dataIndex: 'evidence', width: 88 },
		{ title: '人工调整', dataIndex: 'action', width: 105 }
	]

	const visible = ref(false)
	const sessionId = ref('')
	const qrState = ref({})
	const rosterList = ref([])
	const loadingQr = ref(false)
	const loadingRoster = ref(false)
	const rotating = ref(false)
	const savingConfig = ref(false)
	const customRefreshSec = ref(30)
	const localCountdown = ref(0)
	const photoModalVisible = ref(false)
	const photoPreviewUrl = ref('')
	const gestureEditVisible = ref(false)
	const editGesturePattern = ref('')
	const savingGesture = ref(false)
	let pollTimer = null
	let secTimer = null

	const hasMode = (m) => (qrState.value.checkinModes || ['qr']).includes(m)
	const modeLabel = (m) => ({ qr: '扫码', scan: '扫码', photo: '拍照', gesture: '手势', location: '定位', manual: '人工', leave_sync: '请假', auto_close: '超时' }[m] || m)
	const statusLabel = (s) => ({ on_time: '准时', late: '迟到', leave: '请假', absent: '缺勤', early_leave: '早退', pending: '待签到' }[s] || s)
	const statusColor = (s) => ({ on_time: 'green', late: 'orange', leave: 'blue', absent: 'red', early_leave: 'volcano', pending: 'default' }[s] || 'default')

	const syncQrState = (data) => {
		qrState.value = data || {}
		localCountdown.value = Number(data?.qrCountdownSeconds ?? 0)
		if (data?.qrRefreshSeconds) {
			customRefreshSec.value = Number(data.qrRefreshSeconds)
		}
	}

	const refreshQrOnly = () => {
		if (!sessionId.value) return
		bizAttendanceApi.sessionQrState({ id: sessionId.value }).then(syncQrState).catch(() => {})
	}

	const refreshAll = () => {
		if (!sessionId.value) return
		loadingQr.value = true
		bizAttendanceApi
			.sessionQrState({ id: sessionId.value })
			.then(syncQrState)
			.finally(() => {
				loadingQr.value = false
			})
		loadingRoster.value = true
		bizAttendanceApi
			.sessionRoster({ id: sessionId.value })
			.then((data) => {
				rosterList.value = data?.roster || []
			})
			.finally(() => {
				loadingRoster.value = false
			})
	}

	const onOpen = (record) => {
		sessionId.value = record.id
		visible.value = true
		refreshAll()
		if (pollTimer) clearInterval(pollTimer)
		if (secTimer) clearInterval(secTimer)
		pollTimer = setInterval(() => {
			if (visible.value && qrState.value.status === 'active') {
				refreshAll()
			}
		}, 10000)
		secTimer = setInterval(() => {
			if (!visible.value || qrState.value.status !== 'active') return
			if (localCountdown.value > 1) {
				localCountdown.value -= 1
			} else {
				refreshQrOnly()
			}
		}, 1000)
	}

	const onClose = () => {
		visible.value = false
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
		if (secTimer) {
			clearInterval(secTimer)
			secTimer = null
		}
		if (photoPreviewUrl.value) {
			URL.revokeObjectURL(photoPreviewUrl.value)
			photoPreviewUrl.value = ''
		}
		emit('updated')
	}

	const handleRotateQr = () => {
		rotating.value = true
		bizAttendanceApi
			.sessionRotateQr({ id: sessionId.value })
			.then((data) => {
				syncQrState(data)
				message.success('二维码已强制刷新，旧码立即失效')
			})
			.finally(() => {
				rotating.value = false
			})
	}

	const applyRefreshConfig = () => {
		if (!customRefreshSec.value || customRefreshSec.value < 5) {
			return message.warning('刷新周期最少 5 秒')
		}
		savingConfig.value = true
		bizAttendanceApi
			.sessionUpdateConfig({ id: sessionId.value, qrRefreshSeconds: customRefreshSec.value })
			.then((data) => {
				syncQrState(data)
				message.success(`刷新周期已调整为 ${customRefreshSec.value} 秒，旧二维码已作废`)
			})
			.finally(() => {
				savingConfig.value = false
			})
	}

	const openGestureEditModal = () => {
		editGesturePattern.value = qrState.value.gesturePattern || ''
		gestureEditVisible.value = true
	}

	const undoEditGesture = () => {
		const pts = String(editGesturePattern.value || '').match(/[1-9]/g) || []
		editGesturePattern.value = pts.slice(0, -1).join('-')
	}

	const applyGestureConfig = () => {
		const pts = String(editGesturePattern.value || '').match(/[1-9]/g) || []
		if (pts.length < 4 || pts.length > 25) {
			return message.warning('手势图案请连接 4~25 个点位')
		}
		if (new Set(pts).size < 3) {
			return message.warning('手势图案请至少经过 3 个不同的九宫格点位')
		}
		savingGesture.value = true
		bizAttendanceApi
			.sessionUpdateConfig({ id: sessionId.value, gesturePattern: pts.join('-') })
			.then((data) => {
				syncQrState(data)
				gestureEditVisible.value = false
				message.success('手势签到图案已更新')
			})
			.finally(() => {
				savingGesture.value = false
			})
	}

	const previewPhoto = (fileId) => {
		fileApi.fileAuthDownload({ id: fileId }).then((res) => {
			if (!res || !res.data) return
			if (photoPreviewUrl.value) URL.revokeObjectURL(photoPreviewUrl.value)
			photoPreviewUrl.value = URL.createObjectURL(res.data)
			photoModalVisible.value = true
		})
	}

	const handleEndSession = () => {
		bizAttendanceApi.sessionEnd({ id: sessionId.value }).then((res) => {
			message.success(`课次已结课，标记缺勤 ${res?.absentMarked ?? 0} 人`)
			refreshAll()
			emit('updated')
		})
	}

	const onStatusChange = (record, targetStatus) => {
		bizAttendanceApi
			.sessionRosterStatus({
				sessionId: sessionId.value,
				statusList: [{ studentId: record.studentId, status: targetStatus }]
			})
			.then(() => {
				message.success(`已将 ${record.studentName} 状态调整为 ${statusLabel(targetStatus)}`)
				refreshAll()
				emit('updated')
			})
	}

	defineExpose({ onOpen })
</script>
