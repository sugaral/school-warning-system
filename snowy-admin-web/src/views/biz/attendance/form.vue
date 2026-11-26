<template>
	<xn-form-container
		title="发起课堂签到课次"
		:width="600"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="课程：" name="courseId">
						<a-select
							v-model:value="formData.courseId"
							:options="courseOptions"
							:loading="loadingCourses"
							:field-names="{ label: 'courseName', value: 'id' }"
							placeholder="请选择启用中的课程"
							show-search
							option-filter-prop="courseName"
							allow-clear
							@dropdown-visible-change="(open) => { if (open && !courseOptions.length) loadCourses() }"
						/>
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="班级：" name="classId">
						<a-select
							v-model:value="formData.classId"
							:options="classOptions"
							:loading="loadingClasses"
							:field-names="{ label: 'className', value: 'id' }"
							placeholder="请选择同学院启用中的班级"
							show-search
							option-filter-prop="className"
							allow-clear
							@dropdown-visible-change="(open) => { if (open && !classOptions.length) loadClasses() }"
						/>
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="14">
					<a-form-item label="开始时间（留空立即开始）：" name="sessionStart">
						<a-date-picker
							v-model:value="formData.sessionStart"
							show-time
							value-format="YYYY-MM-DD HH:mm:ss"
							class="xn-wd"
						/>
					</a-form-item>
				</a-col>
				<a-col :span="10">
					<a-form-item label="签到有效时长（分钟）：" name="expireMinutes">
						<a-input-number v-model:value="formData.expireMinutes" class="xn-wd" :min="1" :max="240" />
					</a-form-item>
				</a-col>
			</a-row>

			<a-form-item label="允许学生使用的签到方式（可多选，教师自由组合）：" name="checkinModes">
				<a-checkbox-group v-model:value="formData.checkinModes">
					<a-checkbox value="qr">扫码签到</a-checkbox>
					<a-checkbox value="photo">拍照签到</a-checkbox>
					<a-checkbox value="gesture">手势签到</a-checkbox>
					<a-checkbox value="location">定位签到</a-checkbox>
				</a-checkbox-group>
			</a-form-item>

			<a-card v-if="hasMode('qr')" size="small" title="动态二维码刷新设置" style="margin-bottom: 12px">
				<a-form-item label="二维码自动刷新间隔（秒，5~3600，刷新后旧码立即失效）：" style="margin-bottom: 6px">
					<a-space>
						<a-input-number v-model:value="formData.qrRefreshSeconds" :min="5" :max="3600" style="width: 130px" />
						<a-button size="small" @click="formData.qrRefreshSeconds = 10">10秒</a-button>
						<a-button size="small" @click="formData.qrRefreshSeconds = 15">15秒</a-button>
						<a-button size="small" @click="formData.qrRefreshSeconds = 30">30秒</a-button>
						<a-button size="small" @click="formData.qrRefreshSeconds = 60">60秒</a-button>
					</a-space>
				</a-form-item>
			</a-card>

			<a-card v-if="hasMode('gesture')" size="small" title="手势签到九宫格设置（支持拖动连线或逐点点击，可重复经过已选点绘制闭合/复杂图形）" style="margin-bottom: 12px">
				<div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap">
					<GesturePatternPad v-model="formData.gesturePattern" :size="220" />
					<div style="flex: 1; min-width: 180px">
						<div style="margin-bottom: 8px">
							当前手势序列：<b>{{ formData.gesturePattern || '未设置（请在左侧绘制）' }}</b>
						</div>
						<div style="color: #888; font-size: 12px; margin-bottom: 10px">
							已连点数：{{ gesturePoints.length }}/25（须 4~25 个点且至少经过 3 个不同点，支持闭合回连，再次点击末位点可撤销）
						</div>
						<a-space wrap style="margin-bottom: 10px">
							<a-button size="small" :disabled="!gesturePoints.length" @click="undoGesture">撤销一步</a-button>
							<a-button size="small" :disabled="!gesturePoints.length" @click="clearGesture">清空重画</a-button>
						</a-space>
						<div style="font-size: 12px; color: #666">
							<span style="margin-right: 6px">快捷预设：</span>
							<a-space size="small" wrap>
								<a-button size="small" type="dashed" @click="formData.gesturePattern = '1-2-3-6-9-8-7-4-1'">方框</a-button>
								<a-button size="small" type="dashed" @click="formData.gesturePattern = '2-7-8-9-2'">三角</a-button>
								<a-button size="small" type="dashed" @click="formData.gesturePattern = '1-2-3-5-7-8-9-5-1'">沙漏</a-button>
								<a-button size="small" type="dashed" @click="formData.gesturePattern = '1-2-3-5-7-8-9'">Z形</a-button>
							</a-space>
						</div>
					</div>
				</div>
			</a-card>

			<a-card v-if="hasMode('location')" size="small" title="定位签到地理围栏设置" style="margin-bottom: 12px">
				<a-row :gutter="10">
					<a-col :span="14">
						<a-form-item label="签到地点名称：" style="margin-bottom: 8px">
							<a-input v-model:value="formData.locationName" placeholder="如：信息楼 A302 教室" />
						</a-form-item>
					</a-col>
					<a-col :span="10">
						<a-form-item label="允许范围半径（米）：" style="margin-bottom: 8px">
							<a-input-number v-model:value="formData.locationRadiusMeters" :min="20" :max="5000" class="xn-wd" />
						</a-form-item>
					</a-col>
				</a-row>
				<a-row :gutter="10">
					<a-col :span="9">
						<a-form-item label="中心纬度 (Lat)：" style="margin-bottom: 4px">
							<a-input-number v-model:value="formData.locationLat" :step="0.0001" :precision="6" class="xn-wd" placeholder="例 39.904200" />
						</a-form-item>
					</a-col>
					<a-col :span="9">
						<a-form-item label="中心经度 (Lng)：" style="margin-bottom: 4px">
							<a-input-number v-model:value="formData.locationLng" :step="0.0001" :precision="6" class="xn-wd" placeholder="例 116.407396" />
						</a-form-item>
					</a-col>
					<a-col :span="6" style="display: flex; align-items: flex-end; padding-bottom: 4px">
						<a-button size="small" @click="fillBrowserLocation" block>获取当前定位</a-button>
					</a-col>
				</a-row>
			</a-card>

			<a-card v-if="hasMode('photo')" size="small" title="拍照签到说明" style="margin-bottom: 12px">
				<a-input v-model:value="formData.photoTip" placeholder="如：请拍摄本人课堂现场照片完成签到" />
			</a-card>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">立即开启签到</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizAttendanceForm">
	import { message } from 'ant-design-vue'
	import { required } from '@/utils/formRules'
	import bizAttendanceApi from '@/api/biz/bizAttendanceApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import GesturePatternPad from './GesturePatternPad.vue'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const courseOptions = ref([])
	const classOptions = ref([])
	const loadingCourses = ref(false)
	const loadingClasses = ref(false)

	const gesturePoints = computed(() => {
		const out = []
		for (const ch of String(formData.value?.gesturePattern || '').match(/[1-9]/g) || []) {
			if (out[out.length - 1] !== ch && out.length < 25) {
				out.push(ch)
			}
		}
		return out
	})

	const formRules = {
		courseId: [required('请选择课程')],
		classId: [required('请选择班级')],
		expireMinutes: [required('请填写签到有效分钟数')]
	}

	const hasMode = (mode) => Array.isArray(formData.value.checkinModes) && formData.value.checkinModes.includes(mode)

	const undoGesture = () => {
		const pts = gesturePoints.value
		if (!pts.length) return
		formData.value.gesturePattern = pts.slice(0, -1).join('-')
	}

	const clearGesture = () => {
		formData.value.gesturePattern = ''
	}

	const fillBrowserLocation = () => {
		if (!navigator.geolocation) {
			return message.warning('当前浏览器不支持定位获取，请手动填写经纬度')
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				formData.value.locationLat = Number(pos.coords.latitude.toFixed(6))
				formData.value.locationLng = Number(pos.coords.longitude.toFixed(6))
				message.success('已填入当前位置经纬度')
			},
			() => message.warning('获取定位失败或权限被拒绝，请手动输入教室经纬度'),
			{ enableHighAccuracy: true, timeout: 6000 }
		)
	}

	const loadCourses = () => {
		loadingCourses.value = true
		return bizCourseApi
			.courseList({})
			.then((data) => {
				courseOptions.value = (data || []).filter((c) => !c.status || c.status === 'active')
			})
			.catch(() => {
				message.warning('课程列表加载失败，请确认后端服务已就绪后展开重试')
			})
			.finally(() => {
				loadingCourses.value = false
			})
	}

	const loadClasses = () => {
		loadingClasses.value = true
		return bizClassApi
			.clazzList({})
			.then((data) => {
				classOptions.value = (data || []).filter((c) => !c.status || c.status === 'active')
			})
			.catch(() => {
				message.warning('班级列表加载失败，请确认后端服务已就绪后展开重试')
			})
			.finally(() => {
				loadingClasses.value = false
			})
	}

	const onOpen = () => {
		visible.value = true
		formData.value = {
			expireMinutes: 45,
			checkinModes: ['qr'],
			qrRefreshSeconds: 30,
			gesturePattern: '',
			locationRadiusMeters: 150,
			locationName: '授课教室',
			photoTip: '请拍摄本人课堂现场照片完成签到'
		}
		loadCourses()
		loadClasses()
	}

	const onClose = () => {
		visible.value = false
		formData.value = {}
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				if (!formData.value.checkinModes || !formData.value.checkinModes.length) {
					return message.warning('请至少选择一种签到方式')
				}
				if (hasMode('gesture')) {
					if (gesturePoints.value.length < 4 || gesturePoints.value.length > 25) {
						return message.warning('手势签到请连接 4~25 个九宫格点位')
					}
					if (new Set(gesturePoints.value).size < 3) {
						return message.warning('手势签到请至少经过 3 个不同的九宫格点位')
					}
				}
				if (hasMode('location') && (formData.value.locationLat == null || formData.value.locationLng == null)) {
					return message.warning('启用定位签到必须填写中心经纬度')
				}
				submitLoading.value = true
				bizAttendanceApi
					.sessionAdd(formData.value)
					.then((res) => {
						onClose()
						emit('successful', res)
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
